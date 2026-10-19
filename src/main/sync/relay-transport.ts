import {
  assertSafePath,
  type RemoteFile,
  type Transport,
} from '../../core/sync/index.ts';

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const maxListingBytes = 8 * 1024 * 1024;

// Content is already encrypted, but plain HTTP would still expose which
// devices sync and when, so it is only allowed to this machine.
export function relayBase(url: string): URL {
  const parsed = new URL(url);
  const local =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    throw new Error('Use an https:// relay address');
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

export function createRelayTransport(options: {
  url: string;
  vaultId: string;
  token: string | null;
  fetch: Fetch;
}): Transport & { register: () => Promise<void> } {
  const base = relayBase(options.url);
  const vaultUrl = new URL(
    `v1/vaults/${encodeURIComponent(options.vaultId)}`,
    base.href.endsWith('/') ? base : `${base.href}/`,
  ).href;
  const headers = (): Record<string, string> =>
    options.token ? { authorization: `Bearer ${options.token}` } : {};

  // A redirect could carry the token to another host, and a 404 on a write
  // would otherwise look like success and stop that file from syncing.
  async function request(url: string, init: RequestInit): Promise<Response> {
    const response = await options.fetch(url, {
      ...init,
      redirect: 'error',
      headers: { ...headers(), ...init.headers },
    });
    const missing = response.status === 404 && init.method === 'GET';
    if (!response.ok && !missing) {
      throw new Error(`The relay answered ${response.status}`);
    }
    return response;
  }

  async function body(
    response: Response,
    maxBytes: number,
  ): Promise<Uint8Array> {
    const tooLarge = () => new Error('The relay sent more than expected');
    if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
      throw tooLarge();
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
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
    return Buffer.concat(chunks);
  }

  const fileUrl = (path: string) =>
    `${vaultUrl}/files/${assertSafePath(path).map(encodeURIComponent).join('/')}`;

  return {
    register: async () => {
      await request(vaultUrl, { method: 'PUT' });
    },
    list: async (prefix) => {
      if (prefix !== '') {
        assertSafePath(prefix.replace(/\/$/, ''));
      }
      const response = await request(
        `${vaultUrl}/files?prefix=${encodeURIComponent(prefix)}`,
        { method: 'GET' },
      );
      if (response.status === 404) {
        return [];
      }
      const files: unknown = JSON.parse(
        Buffer.from(await body(response, maxListingBytes)).toString('utf8'),
      );
      return Array.isArray(files) ? files.filter(isRemoteFile) : [];
    },
    read: async (path, maxBytes) => {
      const response = await request(fileUrl(path), { method: 'GET' });
      return response.status === 404 ? null : body(response, maxBytes);
    },
    write: async (path, data) => {
      await request(fileUrl(path), { method: 'PUT', body: Buffer.from(data) });
    },
    remove: async (path) => {
      await request(fileUrl(path), { method: 'DELETE' });
    },
  };
}
