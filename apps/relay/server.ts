// SPDX-FileCopyrightText: 2026 Dima Barabash
// SPDX-License-Identifier: AGPL-3.0-only

import { createHash, timingSafeEqual } from 'node:crypto';
import type { Stats } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import path from 'node:path';
import {
  authorizeTeamWrite,
  bodyLimitFor,
  canManage,
  claimedIdentity,
  checkAppend,
  checkListRoom,
  countWrite,
  createSizedCache,
  decodeAccessList,
  encodeAccessList,
  hourMs,
  identityHex,
  nonceStanding,
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
  type LiveNonce,
  type NonceLimits,
  type RecordBody,
  type Refusal,
  type RelayRoute,
  type SignedAccessRecord,
  type VerifiedRelayRequest,
  type WriteBudget,
} from '@nod/core/sharing/relay';
import { sourceNotice, sourcePath, sourceUrlFrom } from './source.ts';

// Vault ids are lowercase hex (a hash's prefix), so no two spellings name one
// folder on a filesystem that ignores case.
const vaultPattern = /^[0-9a-f]{32}$/;

export type ServerLimits = WriteBudget & {
  // What @nod/core reads at most; a larger file would be refused by every
  // other device.
  fileBytes: number;
  files: number;
  vaultBytes: number;
  newVaultsPerHour: number;
  listBytes: number;
  listReserveBytes: number;
  listOwnerReserveBytes: number;
  // Live nonces per vault: enough for a burst of legitimate writes within
  // one window; one identity holds at most an eighth of them.
  liveNonces: number;
  // The last of them take only an owner's or admin's repair.
  repairNonces: number;
  ownerRepairNonces: number;
  inviteFiles: number;
  inviteFileMs: number;
  teamCacheBytes: number;
  usageKept: number;
};

export const defaultServerLimits: ServerLimits = {
  fileBytes: 16 * 1024 * 1024,
  files: 10_000,
  vaultBytes: 1024 * 1024 * 1024,
  newVaultsPerHour: 60,
  listBytes: 8 * 1024 * 1024,
  listReserveBytes: 1024 * 1024,
  listOwnerReserveBytes: 512 * 1024,
  liveNonces: 1200,
  repairNonces: 32,
  ownerRepairNonces: 16,
  inviteFiles: 8,
  inviteFileMs: 7 * 24 * 60 * 60 * 1000,
  teamCacheBytes: 64 * 1024 * 1024,
  usageKept: 4096,
  writesPerHour: 3_600,
  identityWritesPerHour: 900,
  recordsPerHour: 6,
  managerRecordsPerHour: 120,
  joinsPerInvitePerHour: 32,
};

type Reply = {
  status: number;
  body?: Uint8Array | string;
  type?: string;
  etag?: string;
  retryAfter?: number;
  refusal?: string;
};

type Team = {
  records: SignedAccessRecord[];
  state: AccessState;
  bytes: Uint8Array;
  version: string;
  stamp: string;
};

type TeamMeta = {
  bindings: Record<string, string>;
  invites: Record<string, number>;
  nonces: LiveNonce[];
  counts: HourCounts;
};

type Usage = { files: number; bytes: number };

type Writer = {
  identity: string;
  record?: { state: AccessState; body: RecordBody };
};

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function refuse(status: number, reason: string): Reply {
  return { status, body: reason, type: 'text/plain' };
}

function refused(refusal: Refusal): Reply {
  return {
    ...refuse(refusal.status, refusal.reason),
    ...(refusal.retryAfterMs
      ? { retryAfter: Math.ceil(refusal.retryAfterMs / 1000) }
      : {}),
    ...(refusal.limit ? { refusal: refusal.limit } : {}),
  };
}

async function bodyOf(
  request: IncomingMessage,
  limit: number,
): Promise<Buffer | null> {
  if (Number(request.headers['content-length'] ?? 0) > limit) {
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += piece.length;
    if (size > limit) {
      return null;
    }
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

function versionOf(data: Uint8Array): string {
  return `"${createHash('sha256').update(data).digest('hex').slice(0, 32)}"`;
}

function stampOf(info: Stats): string {
  return `${info.mtimeMs}-${info.size}`;
}

// Stores encrypted files for vaults and nothing else: it can't read them,
// never merges them, and only lets a vault's own devices touch its files. A
// token vault is registered by its token, a team vault by its root record,
// after which every request to it is signed by a member's identity and
// checked against the team's access list.
// `host` is the public host (with its port, if any) that signed requests name.
// Behind a reverse proxy that rewrites `Host` to the upstream address it must
// be set, or every signed request fails; without it the `Host` header is used.
// One process serves a data directory: changes to a vault are ordered in
// memory, so a second process on the same directory would break that.
export function createRelay(
  dataDirectory: string,
  options: {
    now?: () => number;
    host?: string;
    limits?: Partial<ServerLimits>;
    sourceUrl?: string;
  } = {},
): Server {
  const now = options.now ?? (() => Date.now());
  const limits: ServerLimits = { ...defaultServerLimits, ...options.limits };
  const maxLiveNonces = limits.liveNonces;
  const maxLiveNoncesPerIdentity = Math.ceil(maxLiveNonces / 8);
  const vaultDir = (vault: string) => path.join(dataDirectory, vault);
  const filesDir = (vault: string) => path.join(vaultDir(vault), 'files');
  const tokenFile = (vault: string) => path.join(vaultDir(vault), 'token');
  const aclFile = (vault: string) => path.join(vaultDir(vault), 'acl.json');
  const metaFile = (vault: string) => path.join(vaultDir(vault), 'team.json');
  const inviteFile = (vault: string, fileId: string) =>
    path.join(vaultDir(vault), 'invites', fileId);
  const teams = createSizedCache<Team>(
    limits.teamCacheBytes,
    (team) => team.bytes.length,
  );
  const usages = createSizedCache<Usage>(limits.usageKept, () => 1);
  const locks = new Map<string, Promise<void>>();
  let newVaults = { hour: -1, count: 0 };

  // Changes to one vault run one at a time, so a record is appended on the
  // head it names and a device folder gets exactly one first writer.
  function locked<T>(vault: string, work: () => Promise<T>): Promise<T> {
    const previous = locks.get(vault) ?? Promise.resolve();
    const run = previous.then(work, work);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    locks.set(vault, settled);
    void settled.then(() => {
      if (locks.get(vault) === settled) {
        locks.delete(vault);
      }
    });
    return run;
  }

  async function authorized(
    vault: string,
    request: IncomingMessage,
  ): Promise<boolean> {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    try {
      const stored = Buffer.from(await readFile(tokenFile(vault), 'utf8'));
      const given = Buffer.from(hashOf(token));
      return (
        token !== '' &&
        stored.length === given.length &&
        timingSafeEqual(stored, given)
      );
    } catch {
      return false;
    }
  }

  async function statOf(file: string): Promise<Stats | null> {
    try {
      return await stat(file);
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      throw error;
    }
  }

  const exists = async (file: string) => (await statOf(file)) !== null;

  async function walk(
    vault: string,
    prefix: string,
  ): Promise<Array<{ path: string; info: Stats }>> {
    const found: Array<{ path: string; info: Stats }> = [];
    const visit = async (relative: string) => {
      let entries;
      try {
        entries = await readdir(
          path.join(filesDir(vault), ...relative.split('/').filter(Boolean)),
          { withFileTypes: true },
        );
      } catch (error) {
        if (isMissing(error)) {
          return;
        }
        throw error;
      }
      for (const entry of entries) {
        const child = `${relative}${entry.name}`;
        if (entry.isDirectory()) {
          await visit(`${child}/`);
        } else if (entry.isFile() && !entry.name.includes('.tmp-')) {
          found.push({
            path: child,
            info: await stat(path.join(filesDir(vault), ...child.split('/'))),
          });
        }
      }
    };
    await visit(prefix);
    return found;
  }

  async function list(vault: string, prefix: string): Promise<Reply> {
    if (!isListingPrefix(prefix)) {
      return { status: 400 };
    }
    const files = (await walk(vault, prefix)).map(({ path: child, info }) => ({
      path: child,
      version: stampOf(info),
      changedAt: info.mtimeMs,
    }));
    return {
      status: 200,
      body: JSON.stringify(files),
      type: 'application/json',
    };
  }

  async function usageOf(vault: string): Promise<Usage> {
    const known = usages.get(vault);
    if (known) {
      return known;
    }
    const files = await walk(vault, '');
    const usage = {
      files: files.length,
      bytes: files.reduce((sum, file) => sum + file.info.size, 0),
    };
    usages.set(vault, usage);
    return usage;
  }

  // A vault holds at most `files` files and `vaultBytes` bytes; the tally is
  // kept in memory and counted again from disk when it was dropped.
  async function storeFile(
    vault: string,
    file: string,
    body: Uint8Array,
  ): Promise<Reply> {
    const usage = await usageOf(vault);
    const old = await statOf(file);
    const next = {
      files: usage.files + (old ? 0 : 1),
      bytes: usage.bytes - (old?.size ?? 0) + body.length,
    };
    if (next.files > limits.files || next.bytes > limits.vaultBytes) {
      return { status: 507 };
    }
    await store(file, body);
    usages.set(vault, next);
    return { status: 204, etag: stampOf(await stat(file)) };
  }

  async function removeFile(vault: string, file: string): Promise<Reply> {
    const usage = await usageOf(vault);
    const old = await statOf(file);
    await rm(file, { force: true });
    if (old) {
      usages.set(vault, {
        files: usage.files - 1,
        bytes: usage.bytes - old.size,
      });
    }
    return { status: 204 };
  }

  // Vault ids cost nothing to make, so the relay takes only so many new ones
  // an hour. Limits per client belong at the proxy, which sees the address.
  function claimNewVault(): Reply | null {
    const hour = Math.floor(now() / hourMs);
    const count = newVaults.hour === hour ? newVaults.count + 1 : 1;
    if (count > limits.newVaultsPerHour) {
      return {
        status: 429,
        retryAfter: Math.ceil((hourMs - (now() % hourMs)) / 1000),
        refusal: 'new-vaults',
      };
    }
    newVaults = { hour, count };
    return null;
  }

  async function readReply(file: string): Promise<Reply> {
    try {
      return {
        status: 200,
        body: await readFile(file),
        type: 'application/octet-stream',
      };
    } catch (error) {
      if (isMissing(error)) {
        return { status: 404 };
      }
      throw error;
    }
  }

  async function store(file: string, body: Uint8Array) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random()}`;
    await writeFile(temporary, body);
    await rename(temporary, file);
  }

  // The list is replayed through the validator to know who may do what, once
  // per version on disk: a cached team is good while the file's size and
  // time stand. A list this relay wrote and can't read back is a fault, not
  // an empty team.
  async function loadTeam(vault: string): Promise<Team | null> {
    const info = await statOf(aclFile(vault));
    if (!info) {
      teams.delete(vault);
      return null;
    }
    const cached = teams.get(vault);
    if (cached?.stamp === stampOf(info)) {
      return cached;
    }
    const data = await readFile(aclFile(vault));
    const records = decodeAccessList(data);
    const replayed = records ? replayAccessList(vault, records) : null;
    if (!records || !replayed?.ok) {
      throw new Error('The team’s list on disk can’t be read');
    }
    const team: Team = {
      records,
      state: replayed.state,
      bytes: data,
      version: versionOf(data),
      stamp: stampOf(info),
    };
    teams.set(vault, team);
    return team;
  }

  async function saveTeam(
    vault: string,
    records: SignedAccessRecord[],
    state: AccessState,
    data: Uint8Array,
  ): Promise<void> {
    await store(aclFile(vault), data);
    teams.set(vault, {
      records,
      state,
      bytes: data,
      version: versionOf(data),
      stamp: stampOf(await stat(aclFile(vault))),
    });
  }

  // Bindings, invite times, live nonces and this hour's counts, in
  // `team.json`, so a restart forgets none of them.
  async function readMeta(vault: string): Promise<TeamMeta> {
    try {
      const raw = parseJsonBytes(await readFile(metaFile(vault)));
      return {
        bindings: parseBindings(raw),
        invites: parseInviteTimes(raw),
        nonces: parseLiveNonces(
          typeof raw === 'object' && raw !== null
            ? Reflect.get(raw, 'nonces')
            : null,
        ),
        counts: parseHourCounts(objectField(raw, 'counts')),
      };
    } catch (error) {
      if (isMissing(error)) {
        return {
          bindings: {},
          invites: {},
          nonces: [],
          counts: parseHourCounts(null),
        };
      }
      throw error;
    }
  }

  // Runs inside the vault's lock, so nothing changes the file in between.
  async function updateMeta(
    vault: string,
    change: (meta: TeamMeta) => TeamMeta | Reply,
  ): Promise<Reply | null> {
    const next = change(await readMeta(vault));
    if (!('nonces' in next)) {
      return next;
    }
    await store(metaFile(vault), Buffer.from(JSON.stringify(next)));
    return null;
  }

  // Only a request the relay is about to act on is remembered, after it was
  // authorized and only when the hour still takes it: the nonce and the count
  // go into one write, so a replayed GET returns what its sender already
  // captured, and a refused request leaves no trace.
  function claim(
    vault: string,
    verified: VerifiedRelayRequest,
    by: Writer | null,
    standing: NonceLimits['standing'] = 'member',
  ) {
    return updateMeta(vault, (meta) => {
      const next = nextNonces(meta.nonces, verified, now(), {
        max: maxLiveNonces,
        perIdentity: maxLiveNoncesPerIdentity,
        reserve: limits.repairNonces,
        ownerReserve: limits.ownerRepairNonces,
        standing,
      });
      if (!next.ok) {
        return refused(next);
      }
      if (!by) {
        return { ...meta, nonces: next.nonces };
      }
      const counted = countWrite(meta.counts, now(), limits, by);
      return counted.ok
        ? { ...meta, nonces: next.nonces, counts: counted.counts }
        : refused(counted);
    });
  }

  // Who a device folder belongs to: the binding the relay keeps, or, when
  // that was lost, the publisher named in a file already in the folder. A
  // folder with files whose publisher can't be read belongs to nobody the
  // relay can name, so nobody writes or deletes there.
  async function boundIdentity(
    vault: string,
    meta: TeamMeta,
    device: string,
  ): Promise<BoundIdentity> {
    const known: string | undefined = meta.bindings[device];
    if (known) {
      return known;
    }
    const folder = path.join(filesDir(vault), 'devices', device);
    let entries: string[];
    try {
      entries = await readdir(folder, { recursive: true });
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      throw error;
    }
    let found = false;
    for (const entry of entries) {
      const file = path.join(folder, entry);
      try {
        if (!(await stat(file)).isFile() || entry.includes('.tmp-')) {
          continue;
        }
        found = true;
        return identityHex(readSignedFileHeader(await readFile(file)).identity);
      } catch {
        continue;
      }
    }
    return found ? 'unknown' : null;
  }

  // The root record registers the vault (its hash is the vault id and its
  // author the owner, so nobody else can claim the id); every later record
  // is appended on the head it names.
  async function appendRecord(
    vault: string,
    me: string,
    verified: VerifiedRelayRequest,
    body: Uint8Array,
  ): Promise<Reply> {
    const record = parseAccessRecord(parseJsonBytes(body));
    if (!record) {
      return refuse(400, 'not a signed access record');
    }
    const team = await loadTeam(vault);
    const checked = checkAppend(team?.state ?? null, me, record, vault);
    if (!checked.ok) {
      return refused(checked);
    }
    if (!team && (await exists(tokenFile(vault)))) {
      return refuse(409, 'this id names a token vault');
    }
    const records = [...(team?.records ?? []), record];
    const data = encodeAccessList(records);
    if (team) {
      const room = checkListRoom(team.state, me, record, data.length, {
        listBytes: limits.listBytes,
        reserveBytes: limits.listReserveBytes,
        ownerReserveBytes: limits.listOwnerReserveBytes,
      });
      if (!room.ok) {
        return refused(room);
      }
    } else {
      const limited = claimNewVault();
      if (limited) {
        return limited;
      }
    }
    const replayed = team
      ? await claim(
          vault,
          verified,
          { identity: me, record: { state: team.state, body: record.body } },
          nonceStanding(team.state, me, record.body.type),
        )
      : await claim(vault, verified, null);
    if (replayed) {
      return replayed;
    }
    await saveTeam(vault, records, checked.state, data);
    return { status: 204 };
  }

  function listRecords(team: Team, known: string | undefined): Reply {
    if (known !== undefined && known === team.version) {
      return { status: 304, etag: team.version };
    }
    return {
      status: 200,
      body: team.bytes,
      type: 'application/json',
      etag: team.version,
    };
  }

  function joinStatus(team: Team, recordId: string, me: string): Reply {
    const status = joinStatusFor(team.state, recordId, me);
    return status
      ? {
          status: 200,
          body: JSON.stringify({ status }),
          type: 'application/json',
        }
      : { status: 404 };
  }

  async function putInvite(
    vault: string,
    fileId: string,
    body: Uint8Array,
    me: string,
    claim: (by: Writer) => Promise<Reply | null>,
  ): Promise<Reply> {
    if (inviteFileIdOf(body) !== fileId) {
      return refuse(400, 'the file id isn’t the file’s hash');
    }
    const next = nextInviteFiles(
      (await readMeta(vault)).invites,
      fileId,
      now(),
      limits.inviteFiles,
      limits.inviteFileMs,
    );
    if (!next.ok) {
      return refused(next);
    }
    const replayed = await claim({ identity: me });
    if (replayed) {
      return replayed;
    }
    for (const id of next.expired) {
      await rm(inviteFile(vault, id), { force: true });
    }
    await store(inviteFile(vault, fileId), body);
    await updateMeta(vault, (meta) => ({ ...meta, invites: next.invites }));
    return { status: 204 };
  }

  // The file opens only with the key in the link, so anyone may fetch it.
  async function readInvite(vault: string, fileId: string): Promise<Reply> {
    const meta = await readMeta(vault);
    return inviteFileLive(meta.invites[fileId], now(), limits.inviteFileMs)
      ? readReply(inviteFile(vault, fileId))
      : { status: 404 };
  }

  async function teamPut(
    vault: string,
    relative: string,
    body: Uint8Array,
    me: string,
    team: Team,
    claim: (by: Writer) => Promise<Reply | null>,
  ): Promise<Reply> {
    const allowed = authorizeTeamWrite(team.state, me, relative, body);
    if (!allowed.ok) {
      return refused(allowed);
    }
    const device = teamFileDeviceOf(relative);
    const bound = await boundIdentity(vault, await readMeta(vault), device);
    if (bound !== null && bound !== me) {
      return refuse(403, 'another identity’s device folder');
    }
    const replayed = await claim({ identity: me });
    if (replayed) {
      return replayed;
    }
    const file = path.join(filesDir(vault), ...relative.split('/'));
    const stored = await storeFile(vault, file, body);
    if (stored.status === 204) {
      await updateMeta(vault, (meta) =>
        meta.bindings[device] === me
          ? meta
          : { ...meta, bindings: { ...meta.bindings, [device]: me } },
      );
    }
    return stored;
  }

  async function teamRemove(
    vault: string,
    relative: string,
    me: string,
    team: Team,
    claim: (by: Writer) => Promise<Reply | null>,
  ): Promise<Reply> {
    const file = path.join(filesDir(vault), ...relative.split('/'));
    if (!(await exists(file))) {
      return { status: 204 };
    }
    const bound = await boundIdentity(
      vault,
      await readMeta(vault),
      teamFileDeviceOf(relative),
    );
    if (!mayRemoveTeamFile(team.state, me, bound)) {
      return refuse(403, 'another identity’s device folder');
    }
    const replayed = await claim({ identity: me });
    if (replayed) {
      return replayed;
    }
    return removeFile(vault, file);
  }

  function teamRoute(
    request: IncomingMessage,
    url: URL,
    route: RelayRoute,
    body: Buffer | null,
    me: string,
    team: Team,
    claim: (by: Writer) => Promise<Reply | null>,
  ): Promise<Reply> | Reply {
    const method = request.method ?? 'GET';
    const { vault, kind, rest } = route;
    const role = roleOf(team.state, me);
    if (kind === undefined) {
      if (method !== 'PUT') {
        return { status: 405 };
      }
      // Registering again changes nothing, so a replay is harmless and
      // claims no nonce.
      return { status: role === null ? 403 : 204 };
    }
    if (kind === 'acl') {
      if (method !== 'GET') {
        return { status: 405 };
      }
      if (rest !== undefined) {
        return joinStatus(team, rest, me);
      }
      const known = request.headers['if-none-match'];
      return role === null
        ? refuse(403, 'not a member')
        : listRecords(team, typeof known === 'string' ? known : undefined);
    }
    if (kind === 'invites') {
      if (method !== 'PUT' || !body) {
        return { status: 405 };
      }
      if (!isInviteFileId(rest)) {
        return { status: 404 };
      }
      if (!canManage(role)) {
        return refuse(403, 'only an owner or admin writes invites');
      }
      return putInvite(vault, rest, body, me, claim);
    }
    if (role === null) {
      return refuse(403, 'not a member');
    }
    if (rest === undefined || rest === '') {
      if (method !== 'GET') {
        return { status: 405 };
      }
      return list(vault, url.searchParams.get('prefix') ?? '');
    }
    if (!isTeamFilePath(rest)) {
      return { status: 400 };
    }
    switch (method) {
      case 'GET':
        return readReply(path.join(filesDir(vault), ...rest.split('/')));
      case 'PUT':
        return body
          ? teamPut(vault, rest, body, me, team, claim)
          : { status: 413 };
      case 'DELETE':
        return teamRemove(vault, rest, me, team, claim);
      default:
        return { status: 405 };
    }
  }

  // A team vault has no token: the request is signed by an identity over
  // everything that names it, and the identity's role in the list decides.
  async function teamRequest(
    request: IncomingMessage,
    url: URL,
    route: RelayRoute,
    header: string,
  ): Promise<Reply> {
    const method = request.method ?? 'GET';
    const { vault, kind, rest } = route;
    if (method !== 'GET' && method !== 'PUT' && method !== 'DELETE') {
      return { status: 405 };
    }
    // A file can be large, so a write for a team that isn't here, or from an
    // identity the list doesn't name, is turned away before it is read.
    if (method === 'PUT' && kind === 'files') {
      const team = await loadTeam(vault);
      if (!team) {
        return { status: 404 };
      }
      const claimed = claimedIdentity(header);
      if (claimed === null || roleOf(team.state, claimed) === null) {
        return refuse(403, 'not a member');
      }
    }
    const body =
      method === 'GET'
        ? null
        : await bodyOf(
            request,
            // Neither a delete nor the register call carries a body.
            method === 'DELETE' || kind === undefined
              ? 0
              : bodyLimitFor(kind, limits.fileBytes),
          );
    if (method !== 'GET' && body === null) {
      return { status: 413 };
    }
    const verified = verifyRelayRequest(
      header,
      {
        host: options.host ?? request.headers.host ?? '',
        method,
        path: `${url.pathname}${url.search}`,
        vaultId: vault,
        body,
      },
      now(),
    );
    if (!verified) {
      return { status: 401 };
    }
    const me = identityHex(verified.identity);
    if (kind === 'acl' && rest === undefined && method === 'PUT' && body) {
      return locked(vault, () => appendRecord(vault, me, verified, body));
    }
    // A change sees the list as it stands when its turn comes, not as it
    // stood when the request arrived.
    const serve = async (): Promise<Reply> => {
      const team = await loadTeam(vault);
      return team
        ? teamRoute(request, url, route, body, me, team, (by) =>
            claim(vault, verified, by),
          )
        : { status: 404 };
    };
    return method === 'GET' ? serve() : locked(vault, serve);
  }

  async function registerToken(
    vault: string,
    request: IncomingMessage,
  ): Promise<Reply> {
    if (await exists(tokenFile(vault))) {
      return { status: (await authorized(vault, request)) ? 204 : 403 };
    }
    const header = request.headers.authorization ?? '';
    if (!header.startsWith('Bearer ') || header.length < 40) {
      return { status: 400 };
    }
    // A vault is named after a hash of its token, so only the holder of the
    // key can register it and nobody can claim a vault id they have seen.
    if (hashOf(header.slice(7)).slice(0, 32) !== vault) {
      return { status: 403 };
    }
    if (await exists(aclFile(vault))) {
      return { status: 403 };
    }
    const limited = claimNewVault();
    if (limited) {
      return limited;
    }
    await mkdir(vaultDir(vault), { recursive: true });
    await writeFile(tokenFile(vault), hashOf(header.slice(7)));
    return { status: 201 };
  }

  async function tokenRequest(
    request: IncomingMessage,
    url: URL,
    route: RelayRoute,
  ): Promise<Reply> {
    const { vault, kind, rest } = route;
    if (kind === 'acl' || kind === 'invites') {
      return { status: 401 };
    }
    if (kind === undefined) {
      if (request.method !== 'PUT') {
        return { status: 405 };
      }
      return locked(vault, () => registerToken(vault, request));
    }
    if (!(await exists(tokenFile(vault)))) {
      return { status: 404 };
    }
    const relative = rest ?? '';
    if (!(await authorized(vault, request))) {
      return { status: 401 };
    }
    if (request.method === 'GET' && relative === '') {
      return list(vault, url.searchParams.get('prefix') ?? '');
    }
    if (!isVaultFilePath(relative)) {
      return { status: 400 };
    }
    const file = path.join(filesDir(vault), ...relative.split('/'));
    if (request.method === 'GET') {
      return readReply(file);
    }
    if (request.method === 'PUT') {
      const body = await bodyOf(request, limits.fileBytes);
      if (!body) {
        return { status: 413 };
      }
      return locked(vault, () => storeFile(vault, file, body));
    }
    if (request.method === 'DELETE') {
      return locked(vault, () => removeFile(vault, file));
    }
    return { status: 405 };
  }

  async function handle(request: IncomingMessage): Promise<Reply> {
    const url = new URL(request.url ?? '/', 'http://relay');
    if (
      url.pathname === sourcePath &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      const notice = sourceNotice(options.sourceUrl);
      return notice === null
        ? { status: 404 }
        : { status: 200, body: notice, type: 'text/plain; charset=utf-8' };
    }
    const route = relayRoute(url.pathname);
    if (!route || !vaultPattern.test(route.vault)) {
      return { status: 404 };
    }
    if (route.kind === 'invites' && request.method === 'GET') {
      return isInviteFileId(route.rest)
        ? readInvite(route.vault, route.rest)
        : { status: 404 };
    }
    const header = request.headers.authorization ?? '';
    return header.startsWith(`${relayRequestScheme} `)
      ? teamRequest(request, url, route, header)
      : tokenRequest(request, url, route);
  }

  return createServer((request, response) => {
    handle(request).then(
      (reply) => {
        // A phone's HTTP cache would otherwise keep listings on its disk.
        response.writeHead(reply.status, {
          'cache-control': 'no-store',
          ...(reply.type ? { 'content-type': reply.type } : {}),
          ...(reply.etag ? { etag: reply.etag } : {}),
          ...(reply.retryAfter
            ? { 'retry-after': String(reply.retryAfter) }
            : {}),
          ...(reply.refusal ? { 'x-relay-refusal': reply.refusal } : {}),
        });
        response.end(reply.body);
      },
      () => {
        response.writeHead(500, { 'cache-control': 'no-store' });
        response.end();
      },
    );
  });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8787);
  const directory =
    process.env.RELAY_DATA ?? path.join(process.cwd(), 'relay-data');
  const host = process.env.RELAY_HOST;
  const sourceUrl = sourceUrlFrom(process.env.RELAY_SOURCE_URL);
  createRelay(directory, {
    ...(host ? { host } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  }).listen(port, () => {
    console.log(`Relay listening on ${port}, storing in ${directory}`);
  });
}
