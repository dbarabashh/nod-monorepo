// SPDX-FileCopyrightText: 2026 Dima Barabash
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  authorizeTeamWrite,
  bodyLimitFor,
  canManage,
  checkAppend,
  checkListRoom,
  claimedIdentity,
  countWrite as countHourWrite,
  createSizedCache,
  decodeAccessList,
  encodeAccessList,
  hourMs,
  identityHex,
  inviteFileIdOf,
  inviteFileLive,
  isInviteFileId,
  isListingPrefix,
  isTeamFilePath,
  isVaultFilePath,
  joinStatusFor,
  mayRemoveTeamFile,
  nextInviteFiles,
  nextNonces,
  nonceStanding,
  numberField,
  objectField,
  parseAccessRecord,
  parseBindings,
  parseHourCounts,
  parseInviteTimes,
  parseJsonBytes,
  parseLiveNonces,
  readSignedFileHeader,
  relayRequestScheme,
  relayRoute,
  replayAccessList,
  roleOf,
  teamFileDeviceOf,
  verifyRelayRequest,
  type AccessState,
  type BoundIdentity,
  type HourCounts,
  type NonceLimits,
  type Refusal,
  type RecordBody,
  type RouteKind,
  type SignedAccessRecord,
  type VerifiedRelayRequest,
} from '@nod/core/sharing/relay';
import { sourceNotice, sourcePath } from '../source.ts';

// `write` with `ifMatch` replaces the object only if it is still at that
// version, and with `ifMatch: null` only if it doesn't exist yet; otherwise it
// throws `Conflict`.
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
  identityWritesPerHour: number;
  recordsPerHour: number;
  managerRecordsPerHour: number;
  joinsPerInvitePerHour: number;
  newVaults: {
    perHour: number;
    perAddressPerHour: number;
    perWideNetworkPerHour: number;
  };
  listBytes: number;
  listReserveBytes: number;
  listOwnerReserveBytes: number;
  liveNonces: number;
  repairNonces: number;
  ownerRepairNonces: number;
  inviteFiles: number;
  inviteFileMs: number;
  teamCacheBytes: number;
};

const dayMs = 24 * hourMs;

// Vercel Functions take request bodies up to 4.5 MB; a meeting is far smaller.
// A team's list is capped at what the app reads of it.
export const defaultLimits: Limits = {
  fileBytes: 4 * 1024 * 1024,
  vaultBytes: 512 * 1024 * 1024,
  newVaultBytesPerDay: 32 * 1024 * 1024,
  files: 10_000,
  writesPerHour: 3_600,
  identityWritesPerHour: 900,
  recordsPerHour: 6,
  managerRecordsPerHour: 120,
  joinsPerInvitePerHour: 32,
  newVaults: { perHour: 300, perAddressPerHour: 3, perWideNetworkPerHour: 10 },
  listBytes: 8 * 1024 * 1024,
  listReserveBytes: 1024 * 1024,
  listOwnerReserveBytes: 512 * 1024,
  // Four times what the write limit allows in one window, so a burst of
  // legitimate writes fits and the object stays small.
  liveNonces: 1200,
  // The last of them take only an owner's or admin's repair.
  repairNonces: 32,
  ownerRepairNonces: 16,
  inviteFiles: 8,
  inviteFileMs: 7 * dayMs,
  teamCacheBytes: 64 * 1024 * 1024,
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

type Index = HourCounts & {
  createdAt: number;
  files: Record<string, Entry>;
  team: boolean;
  bindings: Record<string, string>;
};

type NewVaults = {
  hour: number;
  vaults: string[];
  byAddress: Record<string, number>;
};

type TeamMeta = { invites: Record<string, number> };

type Team = {
  records: SignedAccessRecord[];
  state: AccessState;
  bytes: Uint8Array;
  version: string;
};

type Known = { index: Index; version: string | null };

type Binding = { device: string; identity: string; rebuilt: string | null };

// Who a write is counted against: nobody (a token vault), a member, or the
// author of a record on the list.
type Writer = {
  identity: string;
  record?: { state: AccessState; body: RecordBody };
} | null;

// Both sides of a client's address: the network one holder can use every
// address of (IPv4 /24, IPv6 /48), and the wider one (IPv4 /16, IPv6 /32)
// that many such networks come from.
export type Networks = { network: string; wide: string };

const vaultPattern = /^[0-9a-f]{32}$/;
const tokenPattern = /^[0-9a-f]{64}$/;
const indexRetries = 8;
// A vault id that names no team (or no invite files) is remembered as such
// for a moment, so requests for it cost no read; another instance may serve
// a team made meanwhile while this one still says 404 for that long.
const absentMs = 10_000;
const absentKept = 10_000;
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

const refuse = (status: number, reason: string) =>
  reply(status, reason, 'text/plain');

const refused = (refusal: Refusal) =>
  reply(refusal.status, refusal.reason, 'text/plain', {
    ...(refusal.retryAfterMs
      ? { 'retry-after': String(Math.ceil(refusal.retryAfterMs / 1000)) }
      : {}),
    ...(refusal.limit ? { 'x-relay-refusal': refusal.limit } : {}),
  });

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
  const raw = parseJsonBytes(data);
  const files: Record<string, Entry> = {};
  const listed = objectField(raw, 'files');
  if (listed) {
    for (const [path, value] of Object.entries(listed)) {
      const entry = parseEntry(value);
      if ((isVaultFilePath(path) || isTeamFilePath(path)) && entry) {
        files[path] = entry;
      }
    }
  }
  return {
    ...parseHourCounts(raw),
    createdAt: numberField(raw, 'createdAt'),
    files,
    team:
      typeof raw === 'object' &&
      raw !== null &&
      Reflect.get(raw, 'team') === true,
    bindings: parseBindings(raw),
  };
}

function parseNewVaults(data: Uint8Array | null): NewVaults {
  const raw = data ? parseJsonBytes(data) : null;
  const byAddress: Record<string, number> = {};
  const listed = objectField(raw, 'byAddress');
  if (listed) {
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

function parseTeamMeta(data: Uint8Array | null): TeamMeta {
  return { invites: parseInviteTimes(data ? parseJsonBytes(data) : null) };
}

const parseNonces = (data: Uint8Array | null) =>
  parseLiveNonces(data ? parseJsonBytes(data) : null);

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
// since one holder of a network can use every address in it, and by the
// wider network (IPv4 /16, IPv6 /32) a holder of many /48s often has.
export function networksOf(header: string | null): Networks {
  let address = (header ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped?.[1]) {
    address = mapped[1];
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    const parts = address.split('.');
    return {
      network: parts.slice(0, 3).join('.'),
      wide: parts.slice(0, 2).join('.'),
    };
  }
  const groups = expandIpv6(address);
  return groups
    ? {
        network: groups.slice(0, 3).join(':'),
        wide: groups.slice(0, 2).join(':'),
      }
    : { network: 'unknown', wide: 'unknown' };
}

export function networkOf(header: string | null): string {
  return networksOf(header).network;
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
// polls for changes costs one small read instead of a listing. A token vault
// is registered by its token; a team vault by its root record, after which
// every request to it is signed by a member's identity and checked against
// the team's access list.
export function createRelayHandler(options: {
  storage: Storage;
  now: () => number;
  addressKey: string;
  limits?: Limits;
  sourceUrl?: string;
}) {
  const { storage, now } = options;
  const limits = options.limits ?? defaultLimits;
  const indexPath = (vault: string) => `vaults/${vault}/index.json`;
  const aclPath = (vault: string) => `vaults/${vault}/acl.json`;
  const teamMetaPath = (vault: string) => `vaults/${vault}/team.json`;
  const noncesPath = (vault: string) => `vaults/${vault}/nonces.json`;
  // One identity holds at most an eighth of the live nonces, so a member
  // can't make every other writer wait.
  const maxLiveNonces = limits.liveNonces;
  const maxLiveNoncesPerIdentity = Math.ceil(maxLiveNonces / 8);
  const filePath = (vault: string, path: string) =>
    `vaults/${vault}/files/${path}`;
  const invitePath = (vault: string, fileId: string) =>
    `vaults/${vault}/invites/${fileId}`;
  const hourOf = (time: number) => Math.floor(time / hourMs);
  const emptyIndex = (team = false): Index => ({
    createdAt: now(),
    files: {},
    hour: 0,
    writes: 0,
    byIdentity: {},
    records: {},
    joins: {},
    team,
    bindings: {},
  });
  const teams = createSizedCache<Team>(
    limits.teamCacheBytes,
    (team) => team.bytes.length,
  );
  const absent = () => {
    const until = new Map<string, number>();
    return {
      has: (vault: string) => (until.get(vault) ?? 0) > now(),
      add: (vault: string) => {
        until.delete(vault);
        until.set(vault, now() + absentMs);
        for (const oldest of until.keys()) {
          if (until.size <= absentKept) {
            break;
          }
          until.delete(oldest);
        }
      },
      delete: (vault: string) => until.delete(vault),
    };
  };
  const noTeam = absent();
  const noInvites = absent();

  async function readIndex(vault: string): Promise<Known> {
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
    team = false,
  ) {
    return update(
      indexPath(vault),
      (data) => (data ? parseIndex(data) : emptyIndex(team)),
      change,
    );
  }

  // Both hourly limits reset on the hour, so the client is told how long to
  // wait instead of guessing.
  const retryOnTheHour = () => ({
    'retry-after': String(Math.ceil((hourMs - (now() % hourMs)) / 1000)),
  });

  function countWrite(index: Index, by: Writer): Index | Response {
    const counted = countHourWrite(index, now(), limits, by);
    return counted.ok ? { ...index, ...counted.counts } : refused(counted);
  }

  // Vault ids cost nothing to make, so new vaults are capped across the relay
  // and per address network. The address is kept only as a keyed hash, for
  // the hour. A vault's first writes may race; it is counted once.
  function claimNewVault(
    vault: string,
    address: Networks,
  ): Promise<Response | null> {
    const hour = hourOf(now());
    const keyOf = (text: string) =>
      createHmac('sha256', options.addressKey)
        .update(`${hour}:${text}`)
        .digest('hex')
        .slice(0, 16);
    const key = keyOf(address.network);
    const wideKey = keyOf(`wide:${address.wide}`);
    return update(newVaultsPath, parseNewVaults, (current) => {
      const fresh =
        current.hour === hour ? current : { hour, vaults: [], byAddress: {} };
      if (fresh.vaults.includes(vault)) {
        return fresh;
      }
      const fromAddress = (fresh.byAddress[key] ?? 0) + 1;
      const fromWide = (fresh.byAddress[wideKey] ?? 0) + 1;
      if (
        fresh.vaults.length + 1 > limits.newVaults.perHour ||
        fromAddress > limits.newVaults.perAddressPerHour ||
        fromWide > limits.newVaults.perWideNetworkPerHour
      ) {
        return reply(429, undefined, undefined, {
          ...retryOnTheHour(),
          'x-relay-refusal': 'new-vaults',
        });
      }
      return {
        hour,
        vaults: [...fresh.vaults, vault],
        byAddress: {
          ...fresh.byAddress,
          [key]: fromAddress,
          [wideKey]: fromWide,
        },
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
  // write, so writes racing each other can't pass them together. A device
  // folder in a team vault is bound to its first writer in the same update.
  function reserve(
    path: string,
    size: number,
    nonce: string,
    binding: Binding | null,
    folder: { fresh: boolean } = { fresh: false },
  ) {
    return (index: Index): Index | Response => {
      const existing = index.files[path];
      // A retried request whose first attempt was stored is already reserved.
      if (existing?.pending?.nonce === nonce) {
        return index;
      }
      if (fresh(existing?.pending)) {
        return reply(409);
      }
      let bindings = index.bindings;
      if (binding) {
        const bound: string | undefined = index.bindings[binding.device];
        if (
          (bound ?? binding.rebuilt ?? binding.identity) !== binding.identity
        ) {
          return refuse(403, 'another identity’s device folder');
        }
        bindings = { ...index.bindings, [binding.device]: binding.identity };
        folder.fresh = index.bindings[binding.device] === undefined;
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
      const written = countWrite(
        index,
        binding ? { identity: binding.identity } : null,
      );
      if (written instanceof Response) {
        return written;
      }
      const pending = { nonce, size, since: now() };
      return {
        ...written,
        bindings,
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
  async function settle(vault: string, index: Index) {
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

  // A reservation given up before anything was stored: the entry keeps what
  // it said before when storage still holds that, so pollers see no change.
  async function release(vault: string, path: string, nonce: string) {
    const stored = await storage.stat(filePath(vault, path));
    await updateIndex(
      vault,
      ifStillPending(path, nonce, (entry) => {
        if (!stored) {
          return null;
        }
        return entry.version === stored.version
          ? {
              version: entry.version,
              changedAt: entry.changedAt,
              size: entry.size,
            }
          : { version: stored.version, changedAt: now(), size: stored.size };
      }),
    );
  }

  // `known` is the index as the caller already read it, so a team write
  // doesn't read it again. `recheck` runs once the write is reserved, right
  // before it is stored: it keeps the request's nonce, and refuses a team
  // write authorized under a list that moved since (a key rotated, a member
  // removed).
  async function put(
    vault: string,
    path: string,
    body: Uint8Array,
    address: Networks,
    binding: Binding | null,
    known?: Known,
    recheck?: () => Promise<Response | null>,
  ) {
    const { index, version: indexVersion } = known ?? (await readIndex(vault));
    // A team was counted when it registered; an index it lost is made again
    // as a team's, not as a new vault.
    if (indexVersion === null && binding === null) {
      const limited = await claimNewVault(vault, address);
      if (limited) {
        return limited;
      }
    } else if (indexVersion !== null) {
      await settle(vault, index);
    }
    const nonce = randomUUID();
    const folder = { fresh: false };
    const blocked = await updateIndex(
      vault,
      reserve(path, body.length, nonce, binding, folder),
      binding !== null,
    );
    if (blocked) {
      return blocked;
    }
    const moved = recheck ? await recheck() : null;
    if (moved) {
      // Nothing was stored for this write, so the entry goes back to what
      // storage holds, and a folder this write bound is let go again.
      await release(vault, path, nonce);
      if (binding && folder.fresh) {
        await updateIndex(vault, (current) => {
          const { [binding.device]: mine, ...others } = current.bindings;
          const holds = Object.entries(current.files).some(
            ([key, entry]) =>
              key.startsWith(`devices/${binding.device}/`) &&
              (entry.version !== '' || entry.pending !== undefined),
          );
          return mine === binding.identity && !holds
            ? { ...current, bindings: others }
            : current;
        });
      }
      return moved;
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
      })) ?? reply(204, undefined, undefined, { etag: version })
    );
  }

  // A delete reserves the file like a write, so a write can't slip in
  // between the index and the blob, and a delete that fails part-way is
  // settled later against what storage holds.
  async function remove(
    vault: string,
    path: string,
    by: string | null,
    known?: Known,
    reserved?: () => Promise<Response | null>,
  ) {
    const { index } = known ?? (await readIndex(vault));
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
      const written = countWrite(current, by ? { identity: by } : null);
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
    const held = reserved ? await reserved() : null;
    if (held) {
      await release(vault, path, nonce);
      return held;
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
    if (!isListingPrefix(prefix)) {
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

  function remember(vault: string, team: Team): Team {
    noTeam.delete(vault);
    teams.set(vault, team);
    return team;
  }

  // The list is replayed through the validator to know who may do what. A
  // list this relay wrote and can't read back is a fault, not an empty team.
  // `fresh` skips what the instance remembers about an absent team, for a
  // write that must see a team registered elsewhere meanwhile.
  async function loadTeam(vault: string, fresh = false): Promise<Team | null> {
    if (!fresh && noTeam.has(vault)) {
      return null;
    }
    const cached = teams.get(vault);
    if (cached) {
      const current = await storage.stat(aclPath(vault));
      if (current?.version === cached.version) {
        return cached;
      }
    }
    const stored = await storage.read(aclPath(vault));
    if (stored === null) {
      teams.delete(vault);
      noTeam.add(vault);
      return null;
    }
    if (cached?.version === stored.version) {
      return cached;
    }
    const records = decodeAccessList(stored.data);
    const replayed = records ? replayAccessList(vault, records) : null;
    if (!records || !replayed?.ok) {
      throw new Error('The team’s list in storage can’t be read');
    }
    return remember(vault, {
      records,
      state: replayed.state,
      bytes: stored.data,
      version: stored.version,
    });
  }

  const nonceLimits = (standing: NonceLimits['standing']): NonceLimits => ({
    max: maxLiveNonces,
    perIdentity: maxLiveNoncesPerIdentity,
    reserve: limits.repairNonces,
    ownerReserve: limits.ownerRepairNonces,
    standing,
  });

  // Only a request the relay is about to act on is remembered, after it was
  // authorized and its write was counted: `check` refuses a replay or a full
  // pool before anything is counted, and `claim` keeps the nonce once the
  // hour took the write. A replayed GET returns what its sender already
  // captured, and a refused request leaves no trace.
  function noncesFor(
    vault: string,
    verified: VerifiedRelayRequest,
    standing: NonceLimits['standing'] = 'member',
  ) {
    return {
      check: async (): Promise<Response | null> => {
        const stored = await storage.read(noncesPath(vault));
        const next = nextNonces(
          parseNonces(stored ? stored.data : null),
          verified,
          now(),
          nonceLimits(standing),
        );
        return next.ok ? null : refused(next);
      },
      claim: () =>
        update(noncesPath(vault), parseNonces, (nonces) => {
          const next = nextNonces(
            nonces,
            verified,
            now(),
            nonceLimits(standing),
          );
          return next.ok ? next.nonces : refused(next);
        }),
    };
  }

  type Nonces = ReturnType<typeof noncesFor>;

  // The root record registers the vault: its hash is the vault id and its
  // author the owner, so nobody else can claim the id. The index is marked
  // as a team's, so the id can never also be a token vault.
  async function registerTeam(
    vault: string,
    record: SignedAccessRecord,
    state: AccessState,
    verified: VerifiedRelayRequest,
    address: Networks,
  ): Promise<Response> {
    const limited = await claimNewVault(vault, address);
    if (limited) {
      return limited;
    }
    const replayed = await noncesFor(vault, verified).claim();
    if (replayed) {
      return replayed;
    }
    try {
      await storage.write(
        indexPath(vault),
        Buffer.from(JSON.stringify(emptyIndex(true))),
        null,
      );
    } catch (failure) {
      if (!(failure instanceof Conflict)) {
        throw failure;
      }
      const { index } = await readIndex(vault);
      if (!index.team) {
        return refuse(409, 'this id names a token vault');
      }
    }
    try {
      const bytes = encodeAccessList([record]);
      const version = await storage.write(aclPath(vault), bytes, null);
      remember(vault, { records: [record], state, bytes, version });
      return reply(204);
    } catch (failure) {
      if (failure instanceof Conflict) {
        return refuse(409, 'the team is already registered');
      }
      throw failure;
    }
  }

  // The list is appended with a conditional write on its version, so two
  // admins acting at once produce one winner and one retry.
  async function appendRecord(
    vault: string,
    me: string,
    verified: VerifiedRelayRequest,
    body: Uint8Array,
    address: Networks,
  ): Promise<Response> {
    const record = parseAccessRecord(parseJsonBytes(body));
    if (!record) {
      return refuse(400, 'not a signed access record');
    }
    let team = await loadTeam(vault, true);
    if (!team) {
      const checked = checkAppend(null, me, record, vault);
      return checked.ok
        ? registerTeam(vault, record, checked.state, verified, address)
        : refused(checked);
    }
    let claimed = false;
    for (let attempt = 0; attempt < indexRetries; attempt += 1) {
      if (!team) {
        return reply(404);
      }
      const checked = checkAppend(team.state, me, record, vault);
      if (!checked.ok) {
        return refused(checked);
      }
      const records = [...team.records, record];
      const data = encodeAccessList(records);
      const room = checkListRoom(team.state, me, record, data.length, {
        listBytes: limits.listBytes,
        reserveBytes: limits.listReserveBytes,
        ownerReserveBytes: limits.listOwnerReserveBytes,
      });
      if (!room.ok) {
        return refused(room);
      }
      if (!claimed) {
        const nonces = noncesFor(
          vault,
          verified,
          nonceStanding(team.state, me, record.body.type),
        );
        const state = team.state;
        const refusedFirst =
          (await nonces.check()) ??
          (await updateIndex(
            vault,
            (index) =>
              countWrite(index, {
                identity: me,
                record: { state, body: record.body },
              }),
            true,
          )) ??
          (await nonces.claim());
        if (refusedFirst) {
          return refusedFirst;
        }
        claimed = true;
      }
      try {
        const version = await storage.write(aclPath(vault), data, team.version);
        remember(vault, {
          records,
          state: checked.state,
          bytes: data,
          version,
        });
        return reply(204);
      } catch (failure) {
        if (!(failure instanceof Conflict)) {
          throw failure;
        }
      }
      team = await loadTeam(vault, true);
    }
    return reply(503);
  }

  function listRecords(team: Team, known: string | null): Response {
    if (known !== null && known === team.version) {
      return reply(304, undefined, undefined, { etag: team.version });
    }
    return reply(200, Buffer.from(team.bytes), 'application/json', {
      etag: team.version,
    });
  }

  function joinStatus(team: Team, recordId: string, me: string): Response {
    const status = joinStatusFor(team.state, recordId, me);
    return status
      ? reply(200, JSON.stringify({ status }), 'application/json')
      : reply(404);
  }

  async function putInvite(
    vault: string,
    fileId: string,
    body: Uint8Array,
    me: string,
    nonces: Nonces,
  ) {
    if (inviteFileIdOf(body) !== fileId) {
      return refuse(400, 'the file id isn’t the file’s hash');
    }
    const replayed =
      (await nonces.check()) ??
      (await updateIndex(
        vault,
        (index) => countWrite(index, { identity: me }),
        true,
      )) ??
      (await nonces.claim());
    if (replayed) {
      return replayed;
    }
    noInvites.delete(vault);
    let expired: string[] = [];
    const full = await update(teamMetaPath(vault), parseTeamMeta, (meta) => {
      const next = nextInviteFiles(
        meta.invites,
        fileId,
        now(),
        limits.inviteFiles,
        limits.inviteFileMs,
      );
      if (!next.ok) {
        return refused(next);
      }
      expired = next.expired;
      return { ...meta, invites: next.invites };
    });
    if (full) {
      return full;
    }
    for (const id of expired) {
      await storage.remove(invitePath(vault, id)).catch(() => undefined);
    }
    await storage.write(invitePath(vault, fileId), body);
    return reply(204);
  }

  // The file opens only with the key in the link, so anyone may fetch it.
  async function readInvite(vault: string, fileId: string) {
    if (noTeam.has(vault) || noInvites.has(vault)) {
      return reply(404);
    }
    const stored = await storage.read(teamMetaPath(vault));
    if (!stored) {
      noInvites.add(vault);
      return reply(404);
    }
    const meta = parseTeamMeta(stored.data);
    if (!inviteFileLive(meta.invites[fileId], now(), limits.inviteFileMs)) {
      return reply(404);
    }
    const file = await storage.read(invitePath(vault, fileId));
    return file
      ? reply(200, Buffer.from(file.data), 'application/octet-stream')
      : reply(404);
  }

  // Who a device folder belongs to: the binding the index keeps, or, for an
  // index that lost it, the publisher named in a file already in the folder.
  // A folder with files whose publisher can't be read belongs to nobody the
  // relay can name, so nobody writes or deletes there.
  async function boundIdentity(
    vault: string,
    index: Index,
    device: string,
  ): Promise<BoundIdentity> {
    const known: string | undefined = index.bindings[device];
    if (known) {
      return known;
    }
    const file = Object.entries(index.files).find(
      ([path, entry]) =>
        path.startsWith(`devices/${device}/`) && entry.version !== '',
    )?.[0];
    if (!file) {
      return null;
    }
    const stored = await storage.read(filePath(vault, file));
    try {
      return stored
        ? identityHex(readSignedFileHeader(stored.data).identity)
        : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  // A member writes only into a folder that is theirs.
  async function teamPut(
    vault: string,
    path: string,
    body: Uint8Array,
    me: string,
    team: Team,
    address: Networks,
    nonces: Nonces,
  ) {
    const allowed = authorizeTeamWrite(team.state, me, path, body);
    if (!allowed.ok) {
      return refused(allowed);
    }
    const device = teamFileDeviceOf(path);
    const known = await readIndex(vault);
    const rebuilt = await boundIdentity(vault, known.index, device);
    if (rebuilt !== null && rebuilt !== me) {
      return refuse(403, 'another identity’s device folder');
    }
    const replayed = await nonces.check();
    if (replayed) {
      return replayed;
    }
    const recheck = async (): Promise<Response | null> => {
      const claimed = await nonces.claim();
      if (claimed) {
        return claimed;
      }
      const current = await storage.stat(aclPath(vault));
      if (current?.version === team.version) {
        return null;
      }
      const latest = await loadTeam(vault);
      if (!latest) {
        return refuse(404, 'no such team');
      }
      const still = authorizeTeamWrite(latest.state, me, path, body);
      return still.ok ? null : refused(still);
    };
    return put(
      vault,
      path,
      body,
      address,
      { device, identity: me, rebuilt },
      known,
      recheck,
    );
  }

  async function teamRemove(
    vault: string,
    path: string,
    me: string,
    team: Team,
    nonces: Nonces,
  ) {
    const known = await readIndex(vault);
    if (!known.index.files[path]) {
      return reply(204);
    }
    const bound = await boundIdentity(
      vault,
      known.index,
      teamFileDeviceOf(path),
    );
    if (!mayRemoveTeamFile(team.state, me, bound)) {
      return refuse(403, 'another identity’s device folder');
    }
    const replayed = await nonces.check();
    if (replayed) {
      return replayed;
    }
    return remove(vault, path, me, known, nonces.claim);
  }

  // A team vault has no token: the request is signed by an identity over
  // everything that names it, and the identity's role in the list decides.
  async function teamRequest(
    request: Request,
    url: URL,
    vault: string,
    kind: RouteKind | undefined,
    rest: string | undefined,
    header: string,
    address: Networks,
  ): Promise<Response> {
    const { method } = request;
    if (method !== 'GET' && method !== 'PUT' && method !== 'DELETE') {
      return reply(405);
    }
    // A file can be large, so a write for a team that isn't here, or from an
    // identity the list doesn't name, is turned away before it is read.
    if (method === 'PUT' && kind === 'files') {
      const team = await loadTeam(vault);
      if (!team) {
        return reply(404);
      }
      const claimed = claimedIdentity(header);
      if (claimed === null || roleOf(team.state, claimed) === null) {
        return refuse(403, 'not a member');
      }
    }
    const body =
      method === 'GET'
        ? null
        : await readBody(
            request,
            // Neither a delete nor the register call carries a body.
            method === 'DELETE' || kind === undefined
              ? 0
              : bodyLimitFor(kind, limits.fileBytes),
          );
    if (method !== 'GET' && body === null) {
      return reply(413);
    }
    const verified = verifyRelayRequest(
      header,
      {
        host: url.host,
        method,
        path: `${url.pathname}${url.search}`,
        vaultId: vault,
        body,
      },
      now(),
    );
    if (!verified) {
      return reply(401);
    }
    const me = identityHex(verified.identity);
    if (kind === 'acl' && rest === undefined && method === 'PUT' && body) {
      return appendRecord(vault, me, verified, body, address);
    }
    const known = request.headers.get('if-none-match');
    const team = await loadTeam(vault);
    if (!team) {
      return reply(404);
    }
    const nonces = noncesFor(vault, verified);
    const role = roleOf(team.state, me);
    if (kind === undefined) {
      if (method !== 'PUT') {
        return reply(405);
      }
      // Registering again changes nothing, so a replay is harmless and
      // claims no nonce.
      return role === null ? reply(403) : reply(204);
    }
    if (kind === 'acl') {
      if (method !== 'GET') {
        return reply(405);
      }
      if (rest !== undefined) {
        return joinStatus(team, rest, me);
      }
      return role === null
        ? refuse(403, 'not a member')
        : listRecords(team, known);
    }
    if (kind === 'invites') {
      if (method !== 'PUT' || !body) {
        return reply(405);
      }
      if (!isInviteFileId(rest)) {
        return reply(404);
      }
      return canManage(role)
        ? putInvite(vault, rest, body, me, nonces)
        : refuse(403, 'only an owner or admin writes invites');
    }
    if (role === null) {
      return refuse(403, 'not a member');
    }
    if (rest === undefined || rest === '') {
      return method === 'GET'
        ? list(vault, url.searchParams.get('prefix') ?? '', known)
        : reply(405);
    }
    if (!isTeamFilePath(rest)) {
      return reply(400);
    }
    switch (method) {
      case 'GET':
        return read(vault, rest);
      case 'PUT':
        return body
          ? teamPut(vault, rest, body, me, team, address, nonces)
          : reply(413);
      case 'DELETE':
        return teamRemove(vault, rest, me, team, nonces);
      default:
        return reply(405);
    }
  }

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (
      url.pathname === sourcePath &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      const notice = sourceNotice(options.sourceUrl);
      return notice === null
        ? reply(404)
        : reply(200, notice, 'text/plain; charset=utf-8');
    }
    const route = relayRoute(url.pathname);
    if (!route || !vaultPattern.test(route.vault)) {
      return reply(404);
    }
    const { vault, kind, rest } = route;
    const address = networksOf(request.headers.get('x-forwarded-for'));
    if (kind === 'invites' && request.method === 'GET') {
      return isInviteFileId(rest) ? readInvite(vault, rest) : reply(404);
    }
    const header = request.headers.get('authorization') ?? '';
    if (header.startsWith(`${relayRequestScheme} `)) {
      return teamRequest(request, url, vault, kind, rest, header, address);
    }
    if (kind === 'acl' || kind === 'invites') {
      return reply(401);
    }
    const allowed = authorized(vault, request);
    if (allowed === null) {
      return reply(401);
    }
    if (!allowed) {
      return reply(403);
    }
    if (kind === undefined) {
      return request.method === 'PUT' ? reply(204) : reply(405);
    }
    if (rest === undefined || rest === '') {
      return request.method === 'GET'
        ? list(
            vault,
            url.searchParams.get('prefix') ?? '',
            request.headers.get('if-none-match'),
          )
        : reply(405);
    }
    if (!isVaultFilePath(rest)) {
      return reply(400);
    }
    switch (request.method) {
      case 'GET':
        return read(vault, rest);
      case 'PUT': {
        const body = await readBody(request, limits.fileBytes);
        return body ? put(vault, rest, body, address, null) : reply(413);
      }
      case 'DELETE':
        return remove(vault, rest, null);
      default:
        return reply(405);
    }
  };
}
