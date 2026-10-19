import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

// What the relay needs from blob storage. `write` with `ifMatch` replaces the
// object only if it is still at that version, and with `ifMatch: null` only if
// it doesn't exist yet; otherwise it throws `Conflict`.
export type Storage = {
  read: (
    pathname: string,
  ) => Promise<{ data: Uint8Array; version: string } | null>;
  stat: (pathname: string) => Promise<{ version: string; size: number } | null>;
  // Reads only if the object is no longer at `version`, so an unchanged
  // index costs no transfer.
  readChanged: (
    pathname: string,
    version: string,
  ) => Promise<{ data: Uint8Array; version: string } | 'unchanged' | null>;
  write: (
    pathname: string,
    data: Uint8Array,
    ifMatch?: string | null,
  ) => Promise<string>;
  remove: (pathname: string) => Promise<void>;
};

export class Conflict extends Error {}

// Storage serves larger objects compressed and marks their ETag weak (W/),
// and a conditional write never matches a weak ETag. The value is the same
// object version either way, so it is used without the mark. An empty one
// would make a conditional write unconditional.
export function versionOf(etag: string): string {
  const version = etag.replace(/^W\//, '');
  if (version === '') {
    throw new Error('Blob storage returned no version');
  }
  return version;
}

export type Limits = {
  fileBytes: number;
  vaultBytes: number;
  newVaultBytesPerDay: number;
  files: number;
  writesPerHour: number;
  newVaults: { perHour: number; perAddressPerHour: number };
};

// Vercel Functions take request bodies up to 4.5 MB; a meeting is far smaller.
export const defaultLimits: Limits = {
  fileBytes: 4 * 1024 * 1024,
  vaultBytes: 512 * 1024 * 1024,
  newVaultBytesPerDay: 32 * 1024 * 1024,
  files: 10_000,
  writesPerHour: 3_600,
  newVaults: { perHour: 300, perAddressPerHour: 3 },
};

// A write in progress. One at a time per file: a second writer is refused
// until the first one finishes or is settled, so the size the index records
// is always the size of the blob that was stored.
type Pending = { nonce: string; size: number; since: number };

type Entry = {
  version: string;
  changedAt: number;
  size: number;
  pending?: Pending;
};

type Index = {
  createdAt: number;
  files: Record<string, Entry>;
  hour: number;
  writes: number;
};

type NewVaults = {
  hour: number;
  vaults: string[];
  byAddress: Record<string, number>;
};

const vaultPattern = /^[0-9a-f]{32}$/;
const tokenPattern = /^[0-9a-f]{64}$/;
const filePattern =
  /^devices\/[A-Za-z0-9_-]{1,64}\/(meetings\/[A-Za-z0-9_-]{1,64}\.bin|closed\.json)$/;
const prefixPattern = /^(devices\/([A-Za-z0-9_-]{1,64}\/(meetings\/)?)?)?$/;
const indexRetries = 8;
const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
// A write that reserved quota and never finished (the function timed out, or
// the index kept changing under it) is settled once it is this old: what was
// stored is counted, and a reservation with nothing behind it is dropped.
// Far longer than a function may run (maxDuration in vercel.json), so a live
// write is never settled from under it.
const reservationMs = 2 * 60 * 1000;
const settledPerWrite = 4;
const newVaultsPath = 'relay/new-vaults.json';

const headers = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function reply(
  status: number,
  body?: BodyInit,
  type?: string,
  extra: Record<string, string> = {},
): Response {
  return new Response(body ?? null, {
    status,
    headers: {
      ...headers,
      ...(type ? { 'content-type': type } : {}),
      ...extra,
    },
  });
}

// The vault id is a hash of its token, so the relay keeps no secret: whoever
// presents a token that hashes to the id holds the vault's key. Nobody can
// claim a vault before its owner, and a leaked id grants nothing.
function authorized(vault: string, request: Request): boolean | null {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length);
  if (!tokenPattern.test(token)) {
    return false;
  }
  const expected = Buffer.from(vault);
  const given = Buffer.from(
    createHash('sha256').update(token).digest('hex').slice(0, 32),
  );
  return timingSafeEqual(expected, given);
}

function parseJson(data: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(data).toString('utf8'));
  } catch {
    return null;
  }
}

function numberField(raw: unknown, key: string): number {
  const value =
    typeof raw === 'object' && raw !== null ? Reflect.get(raw, key) : null;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parsePending(value: unknown): Pending | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const nonce = Reflect.get(value, 'nonce');
  const size = Reflect.get(value, 'size');
  const since = Reflect.get(value, 'since');
  return typeof nonce === 'string' && isSize(size) && typeof since === 'number'
    ? { nonce, size, since }
    : undefined;
}

function parseEntry(value: unknown): Entry | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const version = Reflect.get(value, 'version');
  const changedAt = Reflect.get(value, 'changedAt');
  const size = Reflect.get(value, 'size');
  if (
    typeof version !== 'string' ||
    typeof changedAt !== 'number' ||
    !isSize(size)
  ) {
    return null;
  }
  const pending = parsePending(Reflect.get(value, 'pending'));
  return pending
    ? { version, changedAt, size, pending }
    : { version, changedAt, size };
}

function counted(entry: Entry): number {
  return Math.max(entry.size, entry.pending?.size ?? 0);
}

// An index that can't be read is treated as empty rather than taking the
// vault down: devices publish their files again on the next round.
function parseIndex(data: Uint8Array): Index {
  const raw = parseJson(data);
  const files: Record<string, Entry> = {};
  const listed =
    typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'files') : null;
  if (typeof listed === 'object' && listed !== null) {
    for (const [path, value] of Object.entries(listed)) {
      const entry = parseEntry(value);
      if (filePattern.test(path) && entry) {
        files[path] = entry;
      }
    }
  }
  return {
    createdAt: numberField(raw, 'createdAt'),
    files,
    hour: numberField(raw, 'hour'),
    writes: numberField(raw, 'writes'),
  };
}

function parseNewVaults(data: Uint8Array | null): NewVaults {
  const raw = data ? parseJson(data) : null;
  const byAddress: Record<string, number> = {};
  const listed =
    typeof raw === 'object' && raw !== null
      ? Reflect.get(raw, 'byAddress')
      : null;
  if (typeof listed === 'object' && listed !== null) {
    for (const [address, count] of Object.entries(listed)) {
      if (/^[0-9a-f]{16}$/.test(address) && typeof count === 'number') {
        byAddress[address] = count;
      }
    }
  }
  const vaults =
    typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'vaults') : null;
  return {
    hour: numberField(raw, 'hour'),
    vaults: Array.isArray(vaults)
      ? vaults.filter(
          (vault) => typeof vault === 'string' && vaultPattern.test(vault),
        )
      : [],
    byAddress,
  };
}

function expandIpv6(address: string): string[] | null {
  const [head = '', tail, extra] = address.split('::');
  if (extra !== undefined) {
    return null;
  }
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? missing !== 0 : missing < 1) {
    return null;
  }
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right];
  return groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))
    ? groups.map((group) => group.replace(/^0+(?=.)/, ''))
    : null;
}

// Vercel replaces x-forwarded-for with the connecting address, so a client
// can't choose it. Addresses are grouped by network (IPv4 /24, IPv6 /48),
// since one holder of a network can use every address in it.
export function networkOf(header: string | null): string {
  let address = (header ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped?.[1]) {
    address = mapped[1];
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    return address.split('.').slice(0, 3).join('.');
  }
  const groups = expandIpv6(address);
  return groups ? groups.slice(0, 3).join(':') : 'unknown';
}

async function readBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) {
    return null;
  }
  const reader = request.body?.getReader();
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
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// Stores encrypted files for vaults and nothing else. It can't read them and
// never merges them. Each vault keeps an index of its files, so a device that
// polls for changes costs one small read instead of a listing.
export function createRelayHandler(options: {
  storage: Storage;
  now: () => number;
  addressKey: string;
  limits?: Limits;
}) {
  const { storage, now } = options;
  const limits = options.limits ?? defaultLimits;
  const indexPath = (vault: string) => `vaults/${vault}/index.json`;
  const filePath = (vault: string, path: string) =>
    `vaults/${vault}/files/${path}`;
  const hourOf = (time: number) => Math.floor(time / hourMs);
  const emptyIndex = (): Index => ({
    createdAt: now(),
    files: {},
    hour: 0,
    writes: 0,
  });

  async function readIndex(vault: string) {
    const stored = await storage.read(indexPath(vault));
    return {
      index: stored ? parseIndex(stored.data) : emptyIndex(),
      version: stored ? stored.version : null,
    };
  }

  // Devices write at the same time; each change is retried on top of the
  // latest version instead of overwriting it.
  async function update<T>(
    path: string,
    parse: (data: Uint8Array | null) => T,
    change: (current: T) => T | Response,
  ): Promise<Response | null> {
    for (let attempt = 0; attempt < indexRetries; attempt += 1) {
      const stored = await storage.read(path);
      const next = change(parse(stored ? stored.data : null));
      if (next instanceof Response) {
        return next;
      }
      try {
        await storage.write(
          path,
          Buffer.from(JSON.stringify(next)),
          stored ? stored.version : null,
        );
        return null;
      } catch (failure) {
        if (!(failure instanceof Conflict)) {
          throw failure;
        }
      }
    }
    return reply(503);
  }

  function updateIndex(
    vault: string,
    change: (index: Index) => Index | Response,
  ) {
    return update(
      indexPath(vault),
      (data) => (data ? parseIndex(data) : emptyIndex()),
      change,
    );
  }

  function countWrite(index: Index): Index | Response {
    const hour = hourOf(now());
    const writes = index.hour === hour ? index.writes + 1 : 1;
    return writes > limits.writesPerHour
      ? reply(429)
      : { ...index, hour, writes };
  }

  // Vault ids cost nothing to make, so new vaults are capped across the relay
  // and per address network. The address is kept only as a keyed hash, for
  // the hour. A vault's first writes may race; it is counted once.
  function claimNewVault(
    vault: string,
    address: string,
  ): Promise<Response | null> {
    const hour = hourOf(now());
    const key = createHmac('sha256', options.addressKey)
      .update(`${hour}:${address}`)
      .digest('hex')
      .slice(0, 16);
    return update(newVaultsPath, parseNewVaults, (current) => {
      const fresh =
        current.hour === hour ? current : { hour, vaults: [], byAddress: {} };
      if (fresh.vaults.includes(vault)) {
        return fresh;
      }
      const fromAddress = (fresh.byAddress[key] ?? 0) + 1;
      if (
        fresh.vaults.length + 1 > limits.newVaults.perHour ||
        fromAddress > limits.newVaults.perAddressPerHour
      ) {
        return reply(429, undefined, undefined, {
          'x-relay-refusal': 'new-vaults',
        });
      }
      return {
        hour,
        vaults: [...fresh.vaults, vault],
        byAddress: { ...fresh.byAddress, [key]: fromAddress },
      };
    });
  }

  // A young vault may hold little and grows by a day's allowance, so vaults
  // made only to store data can't each take the full quota at once.
  function vaultAllowance(index: Index): number {
    const days = Math.max(0, Math.floor((now() - index.createdAt) / dayMs));
    return Math.min(limits.vaultBytes, limits.newVaultBytesPerDay * (days + 1));
  }

  const fresh = (pending: Pending | undefined) =>
    pending !== undefined && now() - pending.since < reservationMs;

  // Quota and rate are checked in the same index update that counts the
  // write, so writes racing each other can't pass them together.
  function reserve(path: string, size: number, nonce: string) {
    return (index: Index): Index | Response => {
      const existing = index.files[path];
      // A retried request whose first attempt was stored is already reserved.
      if (existing?.pending?.nonce === nonce) {
        return index;
      }
      if (fresh(existing?.pending)) {
        return reply(409);
      }
      const others = Object.entries(index.files).filter(
        ([key]) => key !== path,
      );
      const total = others.reduce((sum, [, entry]) => sum + counted(entry), 0);
      if (
        others.length + 1 > limits.files ||
        total + size > vaultAllowance(index)
      ) {
        return reply(507);
      }
      const written = countWrite(index);
      if (written instanceof Response) {
        return written;
      }
      const pending = { nonce, size, since: now() };
      return {
        ...written,
        files: {
          ...index.files,
          [path]: existing
            ? { ...existing, pending }
            : { version: '', changedAt: now(), size: 0, pending },
        },
      };
    };
  }

  // The index entry changes only while it still holds this write's
  // reservation, so a writer that was settled or overtaken changes nothing.
  function ifStillPending(
    path: string,
    nonce: string,
    change: (entry: Entry) => Entry | null,
  ) {
    return (index: Index): Index | Response => {
      const entry = index.files[path];
      if (entry?.pending?.nonce !== nonce) {
        return reply(409);
      }
      const files = { ...index.files };
      const next = change(entry);
      if (next) {
        files[path] = next;
      } else {
        delete files[path];
      }
      return { ...index, files };
    };
  }

  // Reservations left behind are settled against what storage holds, so an
  // unfinished write neither hides a stored file from the quota nor keeps
  // counting a file that was never stored.
  async function settle(vault: string) {
    const { index } = await readIndex(vault);
    const stale = Object.entries(index.files)
      .filter(([, entry]) => entry.pending && !fresh(entry.pending))
      .slice(0, settledPerWrite);
    for (const [path, entry] of stale) {
      await resolveFromStorage(vault, path, entry.pending?.nonce ?? '');
    }
  }

  async function resolveFromStorage(
    vault: string,
    path: string,
    nonce: string,
  ) {
    const stored = await storage.stat(filePath(vault, path));
    await updateIndex(
      vault,
      ifStillPending(path, nonce, () =>
        stored
          ? { version: stored.version, changedAt: now(), size: stored.size }
          : null,
      ),
    );
  }

  async function put(
    vault: string,
    path: string,
    request: Request,
    address: string,
  ) {
    const body = await readBody(request, limits.fileBytes);
    if (!body) {
      return reply(413);
    }
    const { version: indexVersion } = await readIndex(vault);
    if (indexVersion === null) {
      const refused = await claimNewVault(vault, address);
      if (refused) {
        return refused;
      }
    } else {
      await settle(vault);
    }
    const nonce = randomUUID();
    const refused = await updateIndex(vault, reserve(path, body.length, nonce));
    if (refused) {
      return refused;
    }
    let version: string;
    try {
      version = await storage.write(filePath(vault, path), body);
    } catch (failure) {
      // A write can fail after it was stored, so the entry is set from what
      // storage holds rather than from what was meant to be written.
      await resolveFromStorage(vault, path, nonce).catch(() => undefined);
      throw failure;
    }
    return (
      (await updateIndex(vault, (index) => {
        const entry = index.files[path];
        if (!entry?.pending && entry?.version === version) {
          return index;
        }
        return ifStillPending(path, nonce, () => ({
          version,
          changedAt: now(),
          size: body.length,
        }))(index);
      })) ?? reply(204)
    );
  }

  // A delete reserves the file like a write, so a write can't slip in
  // between the index and the blob, and a delete that fails part-way is
  // settled later against what storage holds.
  async function remove(vault: string, path: string) {
    const { index } = await readIndex(vault);
    if (!index.files[path]) {
      return reply(204);
    }
    const nonce = randomUUID();
    const refused = await updateIndex(vault, (current) => {
      const entry = current.files[path];
      if (!entry || entry.pending?.nonce === nonce) {
        return current;
      }
      if (fresh(entry.pending)) {
        return reply(409);
      }
      const written = countWrite(current);
      if (written instanceof Response) {
        return written;
      }
      return {
        ...written,
        files: {
          ...written.files,
          [path]: {
            ...entry,
            pending: { nonce, size: entry.size, since: now() },
          },
        },
      };
    });
    if (refused) {
      return refused;
    }
    await storage.remove(filePath(vault, path));
    const dropped = await updateIndex(vault, (current) =>
      current.files[path]?.pending?.nonce === nonce
        ? ifStillPending(path, nonce, () => null)(current)
        : current,
    );
    return dropped ?? reply(204);
  }

  // Devices poll the listing often and it rarely changes, so it carries the
  // index version: a device that sends it back gets 304 and no body.
  async function list(vault: string, prefix: string, known: string | null) {
    if (!prefixPattern.test(prefix)) {
      return reply(400);
    }
    const stored = known
      ? await storage.readChanged(indexPath(vault), known)
      : await storage.read(indexPath(vault));
    if (stored === 'unchanged') {
      return reply(304, undefined, undefined, { etag: known ?? '' });
    }
    const index = stored ? parseIndex(stored.data) : emptyIndex();
    const files = Object.entries(index.files)
      .filter(([path, entry]) => path.startsWith(prefix) && entry.version)
      .map(([path, entry]) => ({
        path,
        version: entry.version,
        changedAt: entry.changedAt,
      }));
    return reply(
      200,
      JSON.stringify(files),
      'application/json',
      stored ? { etag: stored.version } : {},
    );
  }

  async function read(vault: string, path: string) {
    const stored = await storage.read(filePath(vault, path));
    return stored
      ? reply(200, Buffer.from(stored.data), 'application/octet-stream')
      : reply(404);
  }

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const match = /^\/v1\/vaults\/([^/]+)(\/files(?:\/(.*))?)?$/.exec(
      url.pathname,
    );
    const vault = match?.[1] ?? '';
    if (!match || !vaultPattern.test(vault)) {
      return reply(404);
    }
    const allowed = authorized(vault, request);
    if (allowed === null) {
      return reply(401);
    }
    if (!allowed) {
      return reply(403);
    }
    if (!match[2]) {
      return request.method === 'PUT' ? reply(204) : reply(405);
    }
    const path = match[3];
    if (path === undefined || path === '') {
      return request.method === 'GET'
        ? list(
            vault,
            url.searchParams.get('prefix') ?? '',
            request.headers.get('if-none-match'),
          )
        : reply(405);
    }
    if (!filePattern.test(path)) {
      return reply(400);
    }
    switch (request.method) {
      case 'GET':
        return read(vault, path);
      case 'PUT':
        return put(
          vault,
          path,
          request,
          networkOf(request.headers.get('x-forwarded-for')),
        );
      case 'DELETE':
        return remove(vault, path);
      default:
        return reply(405);
    }
  };
}
