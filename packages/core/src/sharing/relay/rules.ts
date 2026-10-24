import { fromBase64Url, textOf, toHex } from '../../crypto/encoding.ts';
import { identityHex, isIdentityHex } from '../../crypto/identity.ts';
import {
  relayRequestWindowMs,
  type VerifiedRelayRequest,
} from '../../crypto/relay-request.ts';
import { readSignedFileHeader } from '../../crypto/signed-file.ts';
import { field } from '../../meetings/field.ts';
import { parseMembersPath, parseNotePath } from '../../sync/layout.ts';
import {
  isJoinRecord,
  isRecordId,
  type RecordBody,
  type RecordType,
  type SignedAccessRecord,
} from '../access-list.ts';
import {
  applyRecord,
  canManage,
  canWrite,
  currentGeneration,
  roleOf,
  startAccessList,
  type AccessState,
  type JoinRequest,
} from '../access-list-validator.ts';
import { isInviteFileId } from '../invite.ts';
import { maxInviteFileBytes, maxRecordBytes } from '../team-place.ts';

// `limit: 'writes'` marks a refusal that stops only writes, so the client
// keeps reading (the relay sends it as `x-relay-refusal: writes`).
export type Refusal = {
  ok: false;
  status: number;
  reason: string;
  retryAfterMs?: number;
  limit?: 'writes';
};

export function refusal(
  status: number,
  reason: string,
  retryAfterMs?: number,
): Refusal {
  return retryAfterMs === undefined
    ? { ok: false, status, reason }
    : { ok: false, status, reason, retryAfterMs };
}

function writesRefusal(reason: string, retryAfterMs: number): Refusal {
  return { ok: false, status: 429, reason, retryAfterMs, limit: 'writes' };
}

export type RouteKind = 'files' | 'acl' | 'invites';

export type RelayRoute = {
  vault: string;
  kind: RouteKind | undefined;
  rest: string | undefined;
};

const routePattern =
  /^\/v1\/vaults\/([^/]+)(?:\/(files|acl|invites)(?:\/(.*))?)?$/;

// `/v1/vaults/<id>`, then `/files`, `/acl` or `/invites`, then whatever the
// kind takes. Each relay decides which vault ids it serves.
export function relayRoute(pathname: string): RelayRoute | null {
  const match = routePattern.exec(pathname);
  if (!match || !match[1]) {
    return null;
  }
  const kind = match[2];
  return {
    vault: match[1],
    kind:
      kind === 'files' || kind === 'acl' || kind === 'invites'
        ? kind
        : undefined,
    rest: match[3],
  };
}

export function bodyLimitFor(
  kind: RouteKind | undefined,
  fileBytes: number,
): number {
  if (kind === 'acl') {
    return maxRecordBytes;
  }
  if (kind === 'invites') {
    return maxInviteFileBytes;
  }
  return fileBytes;
}

// A device folder in a team vault is named by a blinded id, always the
// lowercase hex of an HMAC-SHA256, so no two spellings name one folder on a
// filesystem that ignores case.
const teamDevicePattern = /^[0-9a-f]{64}$/;

export function isTeamDeviceId(value: string): boolean {
  return teamDevicePattern.test(value);
}

// Only notes and the members file exist in a team vault.
export function isTeamFilePath(path: string): boolean {
  return (
    (parseNotePath(path) !== null || parseMembersPath(path) !== null) &&
    isTeamDeviceId(path.split('/')[1] ?? '')
  );
}

export function teamFileDeviceOf(path: string): string {
  return isTeamFilePath(path) ? (path.split('/')[1] ?? '') : '';
}

const vaultFilePattern =
  /^devices\/[A-Za-z0-9_-]{1,64}\/((meetings|notes)\/[A-Za-z0-9_-]{1,64}\.bin|closed\.json|shares\.bin)$/;
const listingPrefixPattern =
  /^(devices\/([A-Za-z0-9_-]{1,64}\/((meetings|notes)\/)?)?)?$/;

// The files a personal or one-to-one vault holds; nothing else is stored.
export function isVaultFilePath(path: string): boolean {
  return vaultFilePattern.test(path);
}

export function isListingPrefix(prefix: string): boolean {
  return listingPrefixPattern.test(prefix);
}

// The identity a signed request names, before its signature is checked: only
// ever used to turn a request away before its body is read, never to let one
// in.
export function claimedIdentity(header: string): string | null {
  try {
    const bytes = fromBase64Url(header.split(' ')[1] ?? '');
    return bytes.length === 32 ? identityHex(bytes) : null;
  } catch {
    return null;
  }
}

export function parseJsonBytes(data: Uint8Array): unknown {
  try {
    return JSON.parse(textOf(data));
  } catch {
    return null;
  }
}

export function objectField(raw: unknown, key: string): object | null {
  const value =
    typeof raw === 'object' && raw !== null ? field(raw, key) : null;
  return typeof value === 'object' && value !== null ? value : null;
}

export function numberField(raw: unknown, key: string): number {
  const value =
    typeof raw === 'object' && raw !== null ? field(raw, key) : null;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function parseBindings(raw: unknown): Record<string, string> {
  const bindings: Record<string, string> = {};
  const bound = objectField(raw, 'bindings');
  if (bound) {
    for (const [device, identity] of Object.entries(bound)) {
      if (
        isTeamDeviceId(device) &&
        typeof identity === 'string' &&
        isIdentityHex(identity)
      ) {
        bindings[device] = identity;
      }
    }
  }
  return bindings;
}

export function parseInviteTimes(raw: unknown): Record<string, number> {
  const invites: Record<string, number> = {};
  const files = objectField(raw, 'invites');
  if (files) {
    for (const [fileId, at] of Object.entries(files)) {
      if (isInviteFileId(fileId) && typeof at === 'number') {
        invites[fileId] = at;
      }
    }
  }
  return invites;
}

// Whether a record may go on the list as it stands (`state`, or null before
// the team is registered), and the list it then makes. The root registers
// the team; a join record is taken from an outsider and follows nothing;
// everything else comes from a member and names the head it follows.
export function checkAppend(
  state: AccessState | null,
  me: string,
  record: SignedAccessRecord,
  vaultId: string,
): { ok: true; state: AccessState } | Refusal {
  if (record.author !== me) {
    return refusal(403, 'the record isn’t the requester’s');
  }
  if (state === null) {
    const started = startAccessList(vaultId, record);
    return started.ok ? started : refusal(400, started.reason);
  }
  const joining = isJoinRecord(record);
  if (!joining && roleOf(state, me) === null) {
    return refusal(403, 'not a member');
  }
  if (!joining && record.prev !== state.head) {
    return refusal(409, 'the list moved');
  }
  const next = applyRecord(state, record);
  if (!next.ok) {
    return refusal(400, next.reason);
  }
  const before = Object.keys(state.members).length;
  const after = Object.keys(next.state.members).length;
  if (after > before && after > maxTeamMembers) {
    return refusal(507, 'the team is full');
  }
  return next;
}

// Every key rotation wraps the key for each member, so a team stays small
// enough for one rotation to fit in a record and the list's reserve to hold
// several.
export const maxTeamMembers = 500;

// Records that let an owner or admin repair a team: take someone out, rotate
// the key, change roles, revoke an invite, hand the team over.
export const repairTypes: RecordType[] = [
  'accountsRemove',
  'keyChange',
  'permissionChanges',
  'inviteRevoke',
  'ownerChange',
];

export function isRepair(state: AccessState, me: string, type: RecordType) {
  return canManage(roleOf(state, me)) && repairTypes.includes(type);
}

// The last `reserveBytes` under the list's cap take only repairs, so a list
// that others filled can still lose them and rotate its key; the last
// `ownerReserveBytes` of those take only the owner's, so an admin who filled
// the rest can still be removed.
export function checkListRoom(
  state: AccessState,
  me: string,
  record: SignedAccessRecord,
  listBytes: number,
  limits: {
    listBytes: number;
    reserveBytes: number;
    ownerReserveBytes: number;
  },
): { ok: true } | Refusal {
  if (listBytes > limits.listBytes) {
    return refusal(507, 'the list is full');
  }
  const repair = isRepair(state, me, record.body.type);
  if (listBytes > limits.listBytes - limits.reserveBytes && !repair) {
    return refusal(507, 'the list keeps its last room for repairs');
  }
  if (
    listBytes > limits.listBytes - limits.ownerReserveBytes &&
    state.owner !== me
  ) {
    return refusal(507, 'the list keeps its last room for the owner');
  }
  return { ok: true };
}

export const hourMs = 60 * 60 * 1000;

// What a vault took this hour: every write, each identity's writes, each
// identity's records on the list, and the joins through each invite.
export type HourCounts = {
  hour: number;
  writes: number;
  byIdentity: Record<string, number>;
  records: Record<string, number>;
  joins: Record<string, number>;
};

export type WriteBudget = {
  writesPerHour: number;
  identityWritesPerHour: number;
  recordsPerHour: number;
  managerRecordsPerHour: number;
  joinsPerInvitePerHour: number;
};

function countsField(
  raw: unknown,
  key: string,
  isKey: (value: string) => boolean,
): Record<string, number> {
  const counts: Record<string, number> = {};
  const listed = objectField(raw, key);
  if (listed) {
    for (const [name, count] of Object.entries(listed)) {
      if (
        isKey(name) &&
        typeof count === 'number' &&
        Number.isSafeInteger(count) &&
        count > 0
      ) {
        counts[name] = count;
      }
    }
  }
  return counts;
}

export function emptyHourCounts(hour = 0): HourCounts {
  return { hour, writes: 0, byIdentity: {}, records: {}, joins: {} };
}

export function parseHourCounts(raw: unknown): HourCounts {
  return {
    hour: numberField(raw, 'hour'),
    writes: numberField(raw, 'writes'),
    byIdentity: countsField(raw, 'byIdentity', isIdentityHex),
    records: countsField(raw, 'records', isIdentityHex),
    joins: countsField(raw, 'joins', isRecordId),
  };
}

// A write is counted against the vault's hour and, in a team vault, against
// the identity that made it, so one member can't spend the whole vault's
// allowance. A record is also counted against its author's records this
// hour, and a join against its invite's joins, since every joiner can be a
// fresh identity; an owner's or admin's repair counts only against its
// author, so a team whose hour others spent can still be repaired.
export function countWrite(
  counts: HourCounts,
  now: number,
  budget: WriteBudget,
  by: {
    identity: string;
    record?: { state: AccessState; body: RecordBody };
  } | null,
): { ok: true; counts: HourCounts } | Refusal {
  const hour = Math.floor(now / hourMs);
  const current: HourCounts =
    counts.hour === hour ? counts : emptyHourCounts(hour);
  const wait = hourMs - (now % hourMs);
  let records = current.records;
  let joins = current.joins;
  if (by?.record) {
    const { state, body } = by.record;
    const type = body.type;
    if (body.type === 'requestJoin' || body.type === 'inviteJoin') {
      const joined = (joins[body.invite] ?? 0) + 1;
      if (joined > budget.joinsPerInvitePerHour) {
        return writesRefusal(
          'too many joins through this invite this hour',
          wait,
        );
      }
      joins = { ...joins, [body.invite]: joined };
    }
    const made = (records[by.identity] ?? 0) + 1;
    const cap = canManage(roleOf(state, by.identity))
      ? budget.managerRecordsPerHour
      : budget.recordsPerHour;
    if (made > cap) {
      return writesRefusal(
        'too many records from this identity this hour',
        wait,
      );
    }
    records = { ...records, [by.identity]: made };
    if (isRepair(state, by.identity, type)) {
      return { ok: true, counts: { ...current, records, joins } };
    }
  }
  const writes = current.writes + 1;
  if (writes > budget.writesPerHour) {
    return writesRefusal(
      'the vault took every write it allows this hour',
      wait,
    );
  }
  if (!by) {
    return { ok: true, counts: { ...current, writes } };
  }
  const mine = (current.byIdentity[by.identity] ?? 0) + 1;
  if (mine > budget.identityWritesPerHour) {
    return writesRefusal('this identity took its share of the hour', wait);
  }
  return {
    ok: true,
    counts: {
      hour,
      writes,
      byIdentity: { ...current.byIdentity, [by.identity]: mine },
      records,
      joins,
    },
  };
}

// A member writes only version 2 files that name them as publisher and the
// current key generation, at a path a team vault has; `members.bin` only an
// owner or admin.
export function authorizeTeamWrite(
  state: AccessState,
  me: string,
  path: string,
  body: Uint8Array,
): { ok: true } | Refusal {
  const role = roleOf(state, me);
  if (role === null) {
    return refusal(403, 'not a member');
  }
  if (!isTeamFilePath(path)) {
    return refusal(400, 'not a team file');
  }
  if (!canWrite(role)) {
    return refusal(403, 'readers don’t write');
  }
  if (parseMembersPath(path) !== null && !canManage(role)) {
    return refusal(403, 'only an owner or admin names members');
  }
  let header: ReturnType<typeof readSignedFileHeader>;
  try {
    header = readSignedFileHeader(body);
  } catch {
    return refusal(400, 'not a signed file');
  }
  if (identityHex(header.identity) !== me) {
    return refusal(403, 'the file names another publisher');
  }
  if (toHex(header.keyId) !== currentGeneration(state).keyId) {
    return refusal(409, 'sealed under a retired key');
  }
  return { ok: true };
}

// 'unknown': the folder holds files whose publisher the relay can't read.
export type BoundIdentity = string | null | 'unknown';

// A file goes by the identity bound to its folder, or by an owner or admin
// once that identity left the list or when nothing was ever bound.
export function mayRemoveTeamFile(
  state: AccessState,
  me: string,
  bound: BoundIdentity,
): boolean {
  if (bound === me) {
    return true;
  }
  return (
    bound !== 'unknown' &&
    canManage(roleOf(state, me)) &&
    (bound === null || roleOf(state, bound) === null)
  );
}

// Only the identity that asked learns how its request fared; to anyone else
// the record doesn't exist.
export function joinStatusFor(
  state: AccessState,
  recordId: string,
  me: string,
): JoinRequest['status'] | null {
  const request = isRecordId(recordId) ? state.requests[recordId] : undefined;
  return request?.identity === me ? request.status : null;
}

export type LiveNonce = { nonce: string; until: number; by: string };

export function parseLiveNonces(raw: unknown): LiveNonce[] {
  const nonces: LiveNonce[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const nonce: unknown = Reflect.get(Object(item), 'nonce');
      const until: unknown = Reflect.get(Object(item), 'until');
      const by: unknown = Reflect.get(Object(item), 'by');
      if (typeof nonce === 'string' && typeof until === 'number') {
        nonces.push({ nonce, until, by: typeof by === 'string' ? by : '' });
      }
    }
  }
  return nonces;
}

// A signed request is taken once. A nonce is kept until the request's own
// signature stops verifying (the relay's clock or the request's time,
// whichever is later, plus the window), since dropping it by the relay's
// clock alone would reopen a request stamped ahead of it. Past `max` live
// nonces, or `perIdentity` from one identity, writers wait rather than the
// list growing without bound; the cap per identity keeps one member from
// holding up the others. The last `reserve` of the pool takes only an owner's
// or admin's repair, so members who filled it can still be removed, and the
// last `ownerReserve` of that only the owner's, so an admin who filled the
// rest can still be removed too.
export type NonceLimits = {
  max: number;
  perIdentity: number;
  reserve: number;
  ownerReserve: number;
  standing: 'member' | 'repair' | 'owner';
};

export function nonceStanding(
  state: AccessState,
  me: string,
  type: RecordType,
): NonceLimits['standing'] {
  if (!isRepair(state, me, type)) {
    return 'member';
  }
  return state.owner === me ? 'owner' : 'repair';
}

export function nextNonces(
  live: LiveNonce[],
  verified: VerifiedRelayRequest,
  now: number,
  limits: NonceLimits,
): { ok: true; nonces: LiveNonce[] } | Refusal {
  const kept = live.filter((entry) => entry.until > now);
  if (kept.some((entry) => entry.nonce === verified.nonce)) {
    return refusal(403, 'a replayed request');
  }
  const by = identityHex(verified.identity);
  const pool =
    limits.standing === 'owner'
      ? limits.max
      : limits.standing === 'repair'
        ? limits.max - limits.ownerReserve
        : limits.max - limits.reserve;
  if (
    kept.length >= pool ||
    kept.filter((entry) => entry.by === by).length >= limits.perIdentity
  ) {
    return writesRefusal('too many live requests', relayRequestWindowMs);
  }
  return {
    ok: true,
    nonces: [
      ...kept,
      {
        nonce: verified.nonce,
        until: Math.max(now, verified.time) + relayRequestWindowMs,
        by,
      },
    ],
  };
}

// Least recently used entries go first once the sizes add up past
// `maxBytes`; an entry larger than that is never kept.
export function createSizedCache<T>(
  maxBytes: number,
  sizeOf: (value: T) => number,
) {
  const entries = new Map<string, { value: T; size: number }>();
  let total = 0;
  const drop = (key: string) => {
    const entry = entries.get(key);
    if (entry) {
      entries.delete(key);
      total -= entry.size;
    }
  };
  return {
    get: (key: string): T | undefined => {
      const entry = entries.get(key);
      if (!entry) {
        return undefined;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set: (key: string, value: T) => {
      drop(key);
      const size = sizeOf(value);
      if (size > maxBytes) {
        return;
      }
      entries.set(key, { value, size });
      total += size;
      for (const oldest of entries.keys()) {
        if (total <= maxBytes) {
          break;
        }
        drop(oldest);
      }
    },
    delete: drop,
    keys: () => [...entries.keys()],
    bytes: () => total,
  };
}

export function inviteFileLive(
  at: number | undefined,
  now: number,
  lifeMs: number,
): boolean {
  return at !== undefined && now - at < lifeMs;
}

// Invite files are few, small and short-lived: a stored one that expired is
// dropped, and a new one is refused once `max` are live.
export function nextInviteFiles(
  invites: Record<string, number>,
  fileId: string,
  now: number,
  max: number,
  lifeMs: number,
): { ok: true; invites: Record<string, number>; expired: string[] } | Refusal {
  const live = Object.entries(invites).filter(([, at]) =>
    inviteFileLive(at, now, lifeMs),
  );
  const expired = Object.keys(invites).filter(
    (id) => !live.some(([liveId]) => liveId === id),
  );
  if (!live.some(([id]) => id === fileId) && live.length >= max) {
    return refusal(507, 'no room for another invite file');
  }
  return {
    ok: true,
    invites: { ...Object.fromEntries(live), [fileId]: now },
    expired,
  };
}
