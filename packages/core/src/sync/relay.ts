import { concatBytes, textOf } from '../crypto/encoding.ts';
import {
  assertSafePath,
  WritesRefused,
  type RemoteFile,
  type Transport,
} from './transport.ts';

// What the transport reads from a response: met by the Fetch API on Node,
// Electron's net.fetch and expo/fetch on mobile.
export type RelayResponse = {
  status: number;
  ok: boolean;
  headers: { get: (name: string) => string | null };
  body: ReadableStream<Uint8Array> | null;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type RelayRequest = {
  method: 'GET' | 'PUT' | 'DELETE';
  headers: Record<string, string>;
  body?: Uint8Array<ArrayBuffer>;
  redirect: 'error';
};

export type Fetch = (url: string, init: RelayRequest) => Promise<RelayResponse>;

const maxListingBytes = 8 * 1024 * 1024;

const vaultWide = new Set([429, 507]);

const refusals: Record<number, string> = {
  409: 'another change to this meeting is still finishing, sync will try again',
  413: 'this meeting is too large to sync through it',
  429: 'too many changes at once, sync will try again later',
  507: 'the space for your devices on it is full',
};

// Content is already encrypted, but plain HTTP would still expose which
// devices sync and when, so it is only allowed to this machine.
export function relayBase(url: string): URL {
  const parsed = new URL(url);
  const local =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    throw new Error('Use an https:// relay address');
  }
  // Only the host and a short path name a relay; anything else in the address
  // is sent with every request and could carry data off to whoever reads it.
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Use a relay address without a login, query or #part');
  }
  if (!/^\/[a-z0-9-/]{0,63}$/.test(parsed.pathname)) {
    throw new Error('Use a relay address with a short, plain path');
  }
  return parsed;
}

function isRemoteFile(value: unknown): value is RemoteFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'path') === 'string' &&
    typeof Reflect.get(value, 'version') === 'string' &&
    typeof Reflect.get(value, 'changedAt') === 'number'
  );
}

// Reads a reply up to maxBytes, refusing more even when its length header
// says less.
export async function readBody(
  response: RelayResponse,
  maxBytes: number,
): Promise<Uint8Array> {
  const tooLarge = () => new Error('The relay sent more than expected');
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    throw tooLarge();
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const whole = new Uint8Array(await response.arrayBuffer());
    if (whole.length > maxBytes) {
      throw tooLarge();
    }
    return whole;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return concatBytes(...chunks);
}

export type RelayTransport = Transport & { register: () => Promise<void> };

export function createRelayTransport(options: {
  url: string;
  vaultId: string;
  token: string | null;
  fetch: Fetch;
}): RelayTransport {
  const base = relayBase(options.url);
  const vaultUrl = new URL(
    `v1/vaults/${encodeURIComponent(options.vaultId)}`,
    base.href.endsWith('/') ? base : `${base.href}/`,
  ).href;
  const headers = (): Record<string, string> =>
    options.token ? { authorization: `Bearer ${options.token}` } : {};

  // A redirect could carry the token to another host, and a 404 on a write
  // would otherwise look like success and stop that file from syncing.
  async function request(
    url: string,
    init: {
      method: RelayRequest['method'];
      headers?: Record<string, string>;
      body?: Uint8Array<ArrayBuffer>;
    },
    known = false,
  ): Promise<RelayResponse> {
    const response = await options.fetch(url, {
      ...init,
      redirect: 'error',
      headers: { ...headers(), ...init.headers },
    });
    const missing = response.status === 404 && init.method === 'GET';
    const unchanged = response.status === 304 && known;
    if (!response.ok && !missing && !unchanged) {
      const reason =
        response.headers.get('x-relay-refusal') === 'new-vaults'
          ? 'it isn’t taking new vaults right now, sync will try again later'
          : refusals[response.status];
      const message = `The relay answered ${response.status}${reason ? `: ${reason}` : ''}`;
      throw vaultWide.has(response.status) && init.method !== 'GET'
        ? new WritesRefused(message)
        : new Error(message);
    }
    return response;
  }

  const listings = new Map<string, { version: string; files: RemoteFile[] }>();

  const fileUrl = (path: string) =>
    `${vaultUrl}/files/${assertSafePath(path).map(encodeURIComponent).join('/')}`;

  return {
    register: async () => {
      await request(vaultUrl, { method: 'PUT' });
    },
    // Each poll sends the version of the listing it already has, and an
    // unchanged listing comes back as 304 with nothing to download.
    list: async (prefix) => {
      if (prefix !== '') {
        assertSafePath(prefix.replace(/\/$/, ''));
      }
      const known = listings.get(prefix);
      const response = await request(
        `${vaultUrl}/files?prefix=${encodeURIComponent(prefix)}`,
        {
          method: 'GET',
          headers: known ? { 'if-none-match': known.version } : {},
        },
        known !== undefined,
      );
      if (response.status === 304 && known) {
        return known.files;
      }
      if (response.status === 404) {
        listings.delete(prefix);
        return [];
      }
      const parsed: unknown = JSON.parse(
        textOf(await readBody(response, maxListingBytes)),
      );
      const files = Array.isArray(parsed) ? parsed.filter(isRemoteFile) : [];
      const version = response.headers.get('etag');
      if (version) {
        listings.set(prefix, { version, files });
      } else {
        listings.delete(prefix);
      }
      return files;
    },
    read: async (path, maxBytes) => {
      const response = await request(fileUrl(path), { method: 'GET' });
      return response.status === 404 ? null : readBody(response, maxBytes);
    },
    write: async (path, data) => {
      await request(fileUrl(path), {
        method: 'PUT',
        body: new Uint8Array(data),
      });
    },
    remove: async (path) => {
      await request(fileUrl(path), { method: 'DELETE' });
    },
  };
}
