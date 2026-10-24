import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { bytesOf, toBase64Url } from '../../crypto/encoding.ts';
import { identityCard, identityOf } from '../../crypto/identity.ts';
import { relayRequestWindowMs } from '../../crypto/relay-request.ts';
import { teamVaultIdOf, type GrantedRole } from '../access-list.ts';
import type { AccessState } from '../access-list-validator.ts';
import {
  accountsAddRecord,
  accountsRemoveRecord,
  inviteFileFor,
  inviteRecord,
  keyChangeRecord,
  requestJoinRecord,
  requestRemoveRecord,
  rootRecord,
  sealedNote,
  testIdentities,
  type CurrentKey,
} from '../testing/index.ts';
import {
  authorizeTeamWrite,
  bodyLimitFor,
  checkAppend,
  checkListRoom,
  claimedIdentity,
  countWrite,
  createSizedCache,
  inviteFileLive,
  isListingPrefix,
  isTeamFilePath,
  isVaultFilePath,
  joinStatusFor,
  maxTeamMembers,
  mayRemoveTeamFile,
  nextInviteFiles,
  nextNonces,
  nonceStanding,
  parseBindings,
  parseInviteTimes,
  parseHourCounts,
  parseJsonBytes,
  parseLiveNonces,
  relayRoute,
  teamFileDeviceOf,
  type HourCounts,
  type LiveNonce,
  type NonceLimits,
  type Refusal,
  type WriteBudget,
} from './rules.ts';

const { owner, admin, writer, reader, stranger, another, hex } =
  testIdentities();
const at = Date.UTC(2026, 0, 1);
const d1 = '1'.repeat(64);
const d2 = '2'.repeat(64);

function stateOf(
  result: { ok: true; state: AccessState } | Refusal,
): AccessState {
  if (!result.ok) {
    throw new Error(`refused: ${result.status} ${result.reason}`);
  }
  return result.state;
}

function noncesOf(
  result: { ok: true; nonces: LiveNonce[] } | Refusal,
): LiveNonce[] {
  if (!result.ok) {
    throw new Error(`refused: ${result.status} ${result.reason}`);
  }
  return result.nonces;
}

// A team of the owner, an admin, a writer and a reader, with its key.
function team() {
  const root = rootRecord(owner, at);
  const vaultId = teamVaultIdOf(root.record);
  const key: CurrentKey = { keyId: root.keyId, rootKey: root.rootKey };
  const started = stateOf(checkAppend(null, hex(owner), root.record, vaultId));
  const added = accountsAddRecord(
    owner,
    started,
    key,
    [
      { card: identityCard(admin), role: 'admin' },
      { card: identityCard(writer), role: 'writer' },
      { card: identityCard(reader), role: 'reader' },
    ],
    at,
  );
  const state = stateOf(checkAppend(started, hex(owner), added, vaultId));
  return { vaultId, key, state, root };
}

describe('relay routes and limits', () => {
  it('parses the vault routes and nothing else', () => {
    assert.deepEqual(relayRoute('/v1/vaults/abc'), {
      vault: 'abc',
      kind: undefined,
      rest: undefined,
    });
    assert.deepEqual(relayRoute('/v1/vaults/abc/files'), {
      vault: 'abc',
      kind: 'files',
      rest: undefined,
    });
    assert.deepEqual(relayRoute('/v1/vaults/abc/files/'), {
      vault: 'abc',
      kind: 'files',
      rest: '',
    });
    assert.deepEqual(
      relayRoute('/v1/vaults/abc/files/devices/d1/notes/n.bin'),
      {
        vault: 'abc',
        kind: 'files',
        rest: 'devices/d1/notes/n.bin',
      },
    );
    assert.deepEqual(relayRoute('/v1/vaults/abc/acl/r1'), {
      vault: 'abc',
      kind: 'acl',
      rest: 'r1',
    });
    assert.deepEqual(relayRoute('/v1/vaults/abc/invites/f1'), {
      vault: 'abc',
      kind: 'invites',
      rest: 'f1',
    });
    assert.equal(relayRoute('/v1/vaults/'), null);
    assert.equal(relayRoute('/v1/vaults/abc/other'), null);
    assert.equal(relayRoute('/v2/vaults/abc'), null);
  });

  it('caps each route’s body at what the app sends there', () => {
    assert.equal(bodyLimitFor('acl', 100), 256 * 1024);
    assert.equal(bodyLimitFor('invites', 100), 8 * 1024);
    assert.equal(bodyLimitFor('files', 100), 100);
    assert.equal(bodyLimitFor(undefined, 100), 100);
  });

  it('knows which files a team vault holds and whose folder they are in', () => {
    assert.equal(isTeamFilePath(`devices/${d1}/notes/n1.bin`), true);
    assert.equal(isTeamFilePath(`devices/${d1}/members.bin`), true);
    for (const path of [
      `devices/${d1}/meetings/m1.bin`,
      `devices/${d1}/closed.json`,
      `devices/${d1}/shares.bin`,
      `devices/${d1}/acl.log`,
      `devices/${d1}/notes/n1.json`,
      'notes/n1.bin',
      'devices/d1/notes/n1.bin',
      `devices/${'A'.repeat(64)}/notes/n1.bin`,
      `devices/${'a'.repeat(63)}/notes/n1.bin`,
      `devices/${'a'.repeat(65)}/members.bin`,
    ]) {
      assert.equal(isTeamFilePath(path), false, path);
    }
    assert.equal(teamFileDeviceOf(`devices/${d1}/notes/n1.bin`), d1);
    assert.equal(teamFileDeviceOf(`devices/${d2}/members.bin`), d2);
    assert.equal(teamFileDeviceOf(`devices/${'A'.repeat(64)}/members.bin`), '');
    assert.equal(teamFileDeviceOf('nothing'), '');
  });

  it('knows which files and listings a token vault has', () => {
    for (const path of [
      'devices/laptop/meetings/m1.bin',
      'devices/laptop/notes/n1.bin',
      'devices/laptop/closed.json',
      'devices/laptop/shares.bin',
    ]) {
      assert.equal(isVaultFilePath(path), true, path);
    }
    for (const path of [
      'pairing/r1/offer.json',
      'devices/laptop/meetings/deep/m1.bin',
      'devices/laptop/members.bin',
      'devices/../token',
      'other.bin',
    ]) {
      assert.equal(isVaultFilePath(path), false, path);
    }
    for (const prefix of [
      '',
      'devices/',
      'devices/laptop/',
      'devices/laptop/notes/',
    ]) {
      assert.equal(isListingPrefix(prefix), true, prefix);
    }
    for (const prefix of ['pairing/', 'devices', 'devices/laptop/other/']) {
      assert.equal(isListingPrefix(prefix), false, prefix);
    }
  });

  it('reads stored bindings and invite times, dropping what isn’t one', () => {
    const identity = hex(owner);
    const raw = parseJsonBytes(
      bytesOf(
        JSON.stringify({
          bindings: {
            [d1]: identity,
            d1: identity,
            ['A'.repeat(64)]: identity,
            [d2]: 'nope',
            ['3'.repeat(64)]: 7,
          },
          invites: { ['a'.repeat(32)]: 5, short: 6, ['b'.repeat(32)]: 'x' },
        }),
      ),
    );
    assert.deepEqual(parseBindings(raw), { [d1]: identity });
    assert.deepEqual(parseInviteTimes(raw), { ['a'.repeat(32)]: 5 });
    assert.deepEqual(parseBindings(null), {});
    assert.deepEqual(parseInviteTimes({ invites: [] }), {});
    assert.equal(parseJsonBytes(bytesOf('{')), null);
  });
});

describe('appending to a team’s list', () => {
  it('registers a team by its root only, from its author only', () => {
    const root = rootRecord(owner, at);
    const vaultId = teamVaultIdOf(root.record);
    const started = stateOf(
      checkAppend(null, hex(owner), root.record, vaultId),
    );
    assert.equal(started.owner, hex(owner));
    assert.equal(started.head, root.record.id);
    assert.deepEqual(checkAppend(null, hex(stranger), root.record, vaultId), {
      ok: false,
      status: 403,
      reason: 'the record isn’t the requester’s',
    });
    assert.deepEqual(
      checkAppend(null, hex(owner), root.record, 'f'.repeat(32)),
      {
        ok: false,
        status: 400,
        reason: 'the root isn’t this vault’s',
      },
    );
    const { state, key } = team();
    const later = accountsAddRecord(owner, state, key, [], at);
    assert.deepEqual(checkAppend(null, hex(owner), later, vaultId), {
      ok: false,
      status: 400,
      reason: 'a list starts with its root',
    });
  });

  it('appends on the head from a member, and refuses the rest with the reason', () => {
    const { vaultId, state, key } = team();
    const stale = inviteRecord(owner, state, key, 'reader', true, at);
    const next = stateOf(checkAppend(state, hex(owner), stale.record, vaultId));
    assert.equal(next.head, stale.record.id);
    assert.deepEqual(checkAppend(next, hex(owner), stale.record, vaultId), {
      ok: false,
      status: 409,
      reason: 'the list moved',
    });
    assert.deepEqual(
      checkAppend(
        state,
        hex(stranger),
        inviteRecord(stranger, state, key, 'reader', true, at).record,
        vaultId,
      ),
      { ok: false, status: 403, reason: 'not a member' },
    );
    assert.deepEqual(
      checkAppend(
        state,
        hex(writer),
        inviteRecord(writer, state, key, 'reader', true, at).record,
        vaultId,
      ),
      {
        ok: false,
        status: 400,
        reason:
          'only an owner or admin invites, and only an owner invites admins',
      },
    );
  });

  it('takes a join record from an outsider, who then learns only their own outcome', () => {
    const { vaultId, state, key } = team();
    const invite = inviteRecord(owner, state, key, 'writer', true, at);
    const invited = stateOf(
      checkAppend(state, hex(owner), invite.record, vaultId),
    );
    const file = inviteFileFor({
      vaultId,
      invite,
      inviter: owner,
      host: 'https://relay.test/',
    });
    const request = requestJoinRecord(stranger, file, null, at);
    const asked = stateOf(
      checkAppend(invited, hex(stranger), request, vaultId),
    );
    assert.equal(joinStatusFor(asked, request.id, hex(stranger)), 'pending');
    assert.equal(joinStatusFor(asked, request.id, hex(owner)), null);
    assert.equal(joinStatusFor(asked, invite.record.id, hex(stranger)), null);
    assert.equal(joinStatusFor(asked, 'not-an-id', hex(stranger)), null);
    assert.deepEqual(checkAppend(asked, hex(stranger), request, vaultId), {
      ok: false,
      status: 400,
      reason: 'this record is already in the list',
    });
  });
});

describe('writing and removing team files', () => {
  it('lets writers publish signed files under the current key, at team paths', () => {
    const { state, key } = team();
    const note = `devices/${d1}/notes/n1.bin`;
    assert.deepEqual(
      authorizeTeamWrite(state, hex(writer), note, sealedNote(key, writer)),
      { ok: true },
    );
    assert.deepEqual(
      authorizeTeamWrite(
        state,
        hex(admin),
        `devices/${d2}/members.bin`,
        sealedNote(key, admin),
      ),
      { ok: true },
    );
    const refusals: Array<[string, string, Uint8Array, number, string]> = [
      [hex(stranger), note, sealedNote(key, stranger), 403, 'not a member'],
      [
        hex(writer),
        `devices/${d1}/meetings/m1.bin`,
        sealedNote(key, writer),
        400,
        'not a team file',
      ],
      [
        hex(reader),
        `devices/${d1}/closed.json`,
        sealedNote(key, reader),
        400,
        'not a team file',
      ],
      [hex(reader), note, sealedNote(key, reader), 403, 'readers don’t write'],
      [
        hex(writer),
        `devices/${d1}/members.bin`,
        sealedNote(key, writer),
        403,
        'only an owner or admin names members',
      ],
      [hex(writer), note, bytesOf('plain'), 400, 'not a signed file'],
      [
        hex(writer),
        note,
        sealedNote(key, owner),
        403,
        'the file names another publisher',
      ],
    ];
    for (const [me, path, body, status, reason] of refusals) {
      assert.deepEqual(
        authorizeTeamWrite(state, me, path, body),
        { ok: false, status, reason },
        reason,
      );
    }
    const rotated = keyChangeRecord(owner, state, key, at);
    const next = stateOf(
      checkAppend(state, hex(owner), rotated.record, state.vaultId),
    );
    assert.deepEqual(
      authorizeTeamWrite(next, hex(writer), note, sealedNote(key, writer)),
      { ok: false, status: 409, reason: 'sealed under a retired key' },
    );
    const fresh: CurrentKey = {
      keyId:
        rotated.record.body.type === 'keyChange'
          ? rotated.record.body.keyChange.keyId
          : '',
      rootKey: rotated.rootKey,
    };
    assert.deepEqual(
      authorizeTeamWrite(next, hex(writer), note, sealedNote(fresh, writer)),
      { ok: true },
    );
  });

  it('lets a file go by its folder’s identity, or a manager once that identity left', () => {
    const { state, key, vaultId } = team();
    assert.equal(mayRemoveTeamFile(state, hex(writer), hex(writer)), true);
    assert.equal(mayRemoveTeamFile(state, hex(reader), hex(reader)), true);
    assert.equal(mayRemoveTeamFile(state, hex(admin), hex(writer)), false);
    assert.equal(mayRemoveTeamFile(state, hex(owner), hex(writer)), false);
    assert.equal(mayRemoveTeamFile(state, hex(owner), null), true);
    assert.equal(mayRemoveTeamFile(state, hex(admin), null), true);
    assert.equal(mayRemoveTeamFile(state, hex(writer), null), false);
    assert.equal(mayRemoveTeamFile(state, hex(owner), 'unknown'), false);
    assert.equal(mayRemoveTeamFile(state, hex(admin), 'unknown'), false);
    const removed = accountsRemoveRecord(owner, state, key, [hex(writer)], at);
    const after: AccessState = stateOf(
      checkAppend(state, hex(owner), removed.record, vaultId),
    );
    assert.equal(mayRemoveTeamFile(after, hex(admin), hex(writer)), true);
    assert.equal(mayRemoveTeamFile(after, hex(owner), hex(writer)), true);
    assert.equal(mayRemoveTeamFile(after, hex(reader), hex(writer)), false);
  });
});

describe('nonces and invite files', () => {
  const identity = new Uint8Array(32);
  const by = '00'.repeat(32);
  const other = new Uint8Array(32).fill(1);
  const now = 1_000_000;

  const limits = (
    max: number,
    perIdentity = max,
    reserve = 0,
    standing: NonceLimits['standing'] = 'member',
    ownerReserve = 0,
  ): NonceLimits => ({ max, perIdentity, reserve, ownerReserve, standing });

  it('remembers a nonce until the request’s own time has passed, and refuses a replay', () => {
    const first = noncesOf(
      nextNonces([], { identity, time: now - 500, nonce: 'a' }, now, limits(3)),
    );
    assert.deepEqual(first, [
      { nonce: 'a', until: now + relayRequestWindowMs, by },
    ]);
    const ahead = noncesOf(
      nextNonces(
        first,
        { identity, time: now + 4_000, nonce: 'b' },
        now,
        limits(3),
      ),
    );
    assert.deepEqual(ahead, [
      { nonce: 'a', until: now + relayRequestWindowMs, by },
      { nonce: 'b', until: now + 4_000 + relayRequestWindowMs, by },
    ]);
    assert.deepEqual(
      nextNonces(ahead, { identity, time: now, nonce: 'a' }, now, limits(3)),
      { ok: false, status: 403, reason: 'a replayed request' },
    );
    const later = now + relayRequestWindowMs + 1;
    const swept = noncesOf(
      nextNonces(
        ahead,
        { identity, time: later, nonce: 'a' },
        later,
        limits(3),
      ),
    );
    assert.deepEqual(
      swept.map((entry) => entry.nonce),
      ['b', 'a'],
    );
  });

  it('caps the live nonces, per identity too, keeps the last of them for repairs, and says how long to wait', () => {
    const live = [
      { nonce: 'a', until: now + 1, by },
      { nonce: 'b', until: now + 1, by },
      { nonce: 'c', until: now, by },
    ];
    const full = {
      ok: false,
      status: 429,
      reason: 'too many live requests',
      retryAfterMs: relayRequestWindowMs,
      limit: 'writes',
    };
    const mine = { identity, time: now, nonce: 'd' };
    const theirs = { identity: other, time: now, nonce: 'd' };
    assert.deepEqual(nextNonces(live, mine, now, limits(2)), full);
    assert.equal(noncesOf(nextNonces(live, mine, now, limits(3))).length, 3);
    assert.deepEqual(nextNonces(live, mine, now, limits(10, 2)), full);
    assert.deepEqual(
      noncesOf(nextNonces(live, theirs, now, limits(10, 2))).at(-1),
      {
        nonce: 'd',
        until: now + relayRequestWindowMs,
        by: '01'.repeat(32),
      },
    );
    assert.deepEqual(nextNonces(live, theirs, now, limits(3, 3, 1)), full);
    assert.equal(
      noncesOf(nextNonces(live, theirs, now, limits(3, 3, 1, 'repair'))).length,
      3,
    );
    assert.deepEqual(
      nextNonces(live, theirs, now, limits(2, 3, 1, 'repair')),
      full,
    );
    assert.deepEqual(
      nextNonces(live, theirs, now, limits(3, 3, 2, 'repair', 1)),
      full,
    );
    assert.equal(
      noncesOf(nextNonces(live, theirs, now, limits(3, 3, 2, 'owner', 1)))
        .length,
      3,
    );
    assert.deepEqual(
      nextNonces(live, theirs, now, limits(2, 3, 2, 'owner', 1)),
      full,
    );
  });

  it('tells an owner’s repair from an admin’s and from anything else', () => {
    const { state, key } = team();
    const rotate = keyChangeRecord(admin, state, key, at).record.body.type;
    const invite = inviteRecord(owner, state, key, 'reader', true, at).record
      .body.type;
    assert.equal(nonceStanding(state, hex(owner), rotate), 'owner');
    assert.equal(nonceStanding(state, hex(admin), rotate), 'repair');
    assert.equal(nonceStanding(state, hex(writer), rotate), 'member');
    assert.equal(nonceStanding(state, hex(owner), invite), 'member');
  });

  it('reads stored nonces, keeping those from before identities were noted', () => {
    assert.deepEqual(
      parseLiveNonces([
        { nonce: 'a', until: 5, by },
        { nonce: 'b', until: 6 },
        { nonce: 7, until: 8 },
        'junk',
      ]),
      [
        { nonce: 'a', until: 5, by },
        { nonce: 'b', until: 6, by: '' },
      ],
    );
    assert.deepEqual(parseLiveNonces({}), []);
  });

  it('keeps few invite files, each for a while', () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    const a = 'a'.repeat(32);
    const b = 'b'.repeat(32);
    const c = 'c'.repeat(32);
    assert.equal(inviteFileLive(undefined, now, week), false);
    assert.equal(inviteFileLive(now - week, now, week), false);
    assert.equal(inviteFileLive(now - week + 1, now, week), true);
    const stored = { [a]: now - week, [b]: now - 10 };
    assert.deepEqual(nextInviteFiles(stored, c, now, 2, week), {
      ok: true,
      invites: { [b]: now - 10, [c]: now },
      expired: [a],
    });
    assert.deepEqual(nextInviteFiles(stored, c, now, 1, week), {
      ok: false,
      status: 507,
      reason: 'no room for another invite file',
    });
    assert.deepEqual(nextInviteFiles(stored, b, now, 1, week), {
      ok: true,
      invites: { [b]: now },
      expired: [a],
    });
  });
});

describe('room on the list and the hourly budget', () => {
  const limits = { listBytes: 1000, reserveBytes: 200, ownerReserveBytes: 100 };

  it('keeps the last room on the list for repairs, and the very last for the owner’s', () => {
    const { state, key } = team();
    const leaving = requestRemoveRecord(writer, state, at);
    const rotate = keyChangeRecord(admin, state, key, at).record;
    const ownerRotate = keyChangeRecord(owner, state, key, at).record;
    const invite = inviteRecord(owner, state, key, 'reader', true, at).record;
    const ownRotate = keyChangeRecord(writer, state, key, at).record;
    assert.deepEqual(checkListRoom(state, hex(writer), leaving, 800, limits), {
      ok: true,
    });
    const reserved = {
      ok: false,
      status: 507,
      reason: 'the list keeps its last room for repairs',
    };
    for (const [me, record] of [
      [hex(writer), leaving],
      [hex(owner), invite],
      [hex(writer), ownRotate],
    ] satisfies Array<[string, typeof leaving]>) {
      assert.deepEqual(checkListRoom(state, me, record, 801, limits), reserved);
    }
    assert.deepEqual(checkListRoom(state, hex(admin), rotate, 900, limits), {
      ok: true,
    });
    assert.deepEqual(checkListRoom(state, hex(admin), rotate, 901, limits), {
      ok: false,
      status: 507,
      reason: 'the list keeps its last room for the owner',
    });
    assert.deepEqual(
      checkListRoom(state, hex(owner), ownerRotate, 1000, limits),
      { ok: true },
    );
    assert.deepEqual(
      checkListRoom(state, hex(owner), ownerRotate, 1001, limits),
      { ok: false, status: 507, reason: 'the list is full' },
    );
  });

  it('lets a team grow only to so many members', () => {
    const { vaultId, key } = team();
    let { state } = team();
    const card = (n: number) => {
      const seed = new Uint8Array(32).fill(7);
      seed[0] = 170;
      seed[1] = n >> 8;
      seed[2] = n & 255;
      return identityCard(identityOf(seed));
    };
    const readers = (
      from: number,
      count: number,
    ): Array<{ card: string; role: GrantedRole }> =>
      Array.from({ length: count }, (_, n) => ({
        card: card(from + n),
        role: 'reader',
      }));
    const add = (from: number, count: number) =>
      checkAppend(
        state,
        hex(owner),
        accountsAddRecord(owner, state, key, readers(from, count), at),
        vaultId,
      );
    for (let from = 0; from < 448; from += 64) {
      state = stateOf(add(from, 64));
    }
    state = stateOf(add(448, 48));
    assert.equal(Object.keys(state.members).length, maxTeamMembers);
    assert.deepEqual(add(496, 1), {
      ok: false,
      status: 507,
      reason: 'the team is full',
    });
    const removed = accountsRemoveRecord(owner, state, key, [hex(reader)], at);
    assert.equal(
      checkAppend(state, hex(owner), removed.record, vaultId).ok,
      true,
    );
  });

  const budget: WriteBudget = {
    writesPerHour: 3,
    identityWritesPerHour: 2,
    recordsPerHour: 1,
    managerRecordsPerHour: 2,
    joinsPerInvitePerHour: 2,
  };
  const hour = 60 * 60 * 1000;
  const now = 10 * hour + 1000;
  const empty: HourCounts = {
    hour: 0,
    writes: 0,
    byIdentity: {},
    records: {},
    joins: {},
  };

  function countsOf(
    result: { ok: true; counts: HourCounts } | Refusal,
  ): HourCounts {
    if (!result.ok) {
      throw new Error(`refused: ${result.status} ${result.reason}`);
    }
    return result.counts;
  }

  it('shares the vault’s hour between identities and starts again on the hour', () => {
    const w = hex(writer);
    const r = hex(reader);
    const one = countsOf(countWrite(empty, now, budget, { identity: w }));
    assert.deepEqual(one, {
      hour: 10,
      writes: 1,
      byIdentity: { [w]: 1 },
      records: {},
      joins: {},
    });
    const two = countsOf(countWrite(one, now, budget, { identity: w }));
    assert.deepEqual(countWrite(two, now, budget, { identity: w }), {
      ok: false,
      status: 429,
      reason: 'this identity took its share of the hour',
      retryAfterMs: hour - 1000,
      limit: 'writes',
    });
    const three = countsOf(countWrite(two, now, budget, { identity: r }));
    assert.deepEqual(countWrite(three, now, budget, null), {
      ok: false,
      status: 429,
      reason: 'the vault took every write it allows this hour',
      retryAfterMs: hour - 1000,
      limit: 'writes',
    });
    assert.deepEqual(countsOf(countWrite(three, now + hour, budget, null)), {
      hour: 11,
      writes: 1,
      byIdentity: {},
      records: {},
      joins: {},
    });
  });

  it('caps each identity’s records, and lets an owner or admin repair past a spent hour', () => {
    const { state, key } = team();
    const w = hex(writer);
    const a = hex(admin);
    const leave = { state, body: requestRemoveRecord(writer, state, at).body };
    const first = countsOf(
      countWrite(empty, now, budget, { identity: w, record: leave }),
    );
    assert.deepEqual(first, {
      hour: 10,
      writes: 1,
      byIdentity: { [w]: 1 },
      records: { [w]: 1 },
      joins: {},
    });
    assert.deepEqual(
      countWrite(first, now, budget, { identity: w, record: leave }),
      {
        ok: false,
        status: 429,
        reason: 'too many records from this identity this hour',
        retryAfterMs: hour - 1000,
        limit: 'writes',
      },
    );
    const spent: HourCounts = { ...empty, hour: 10, writes: 3 };
    const rotate = {
      state,
      body: keyChangeRecord(admin, state, key, at).record.body,
    };
    const repaired = countsOf(
      countWrite(spent, now, budget, { identity: a, record: rotate }),
    );
    assert.deepEqual(repaired, { ...spent, records: { [a]: 1 } });
    const twice = countsOf(
      countWrite(repaired, now, budget, { identity: a, record: rotate }),
    );
    assert.equal(
      countWrite(twice, now, budget, { identity: a, record: rotate }).ok,
      false,
    );
    const invite = {
      state,
      body: inviteRecord(owner, state, key, 'reader', true, at).record.body,
    };
    assert.equal(
      countWrite(spent, now, budget, { identity: hex(owner), record: invite })
        .ok,
      false,
    );
  });

  it('caps the joins through one invite, whoever joins', () => {
    const { vaultId, state, key } = team();
    const invite = inviteRecord(owner, state, key, 'writer', true, at);
    const invited = stateOf(
      checkAppend(state, hex(owner), invite.record, vaultId),
    );
    const file = inviteFileFor({
      vaultId,
      invite,
      inviter: owner,
      host: 'https://relay.test/',
    });
    const join = (who: typeof stranger) => ({
      identity: hex(who),
      record: {
        state: invited,
        body: requestJoinRecord(who, file, null, at).body,
      },
    });
    const one = countsOf(countWrite(empty, now, budget, join(stranger)));
    assert.deepEqual(one.joins, { [invite.record.id]: 1 });
    const two = countsOf(countWrite(one, now, budget, join(another)));
    assert.deepEqual(countWrite(two, now, budget, join(admin)), {
      ok: false,
      status: 429,
      reason: 'too many joins through this invite this hour',
      retryAfterMs: hour - 1000,
      limit: 'writes',
    });
    assert.deepEqual(
      countsOf(countWrite(two, now + hour, budget, join(admin))).joins,
      { [invite.record.id]: 1 },
    );
  });

  it('reads stored counts, dropping what isn’t one', () => {
    const w = hex(writer);
    const id = 'c'.repeat(64);
    assert.deepEqual(
      parseHourCounts({
        hour: 4,
        writes: 2,
        byIdentity: { [w]: 2, nope: 3, [hex(reader)]: -1 },
        records: { [w]: 1.5, [hex(admin)]: 'x' },
        joins: { [id]: 3, short: 1 },
      }),
      {
        hour: 4,
        writes: 2,
        byIdentity: { [w]: 2 },
        records: {},
        joins: { [id]: 3 },
      },
    );
    assert.deepEqual(parseHourCounts(null), empty);
  });
});

describe('the identity a request names', () => {
  it('reads it from the header without checking the signature, and nothing else', () => {
    const identity = hex(owner);
    const named = toBase64Url(owner.publicKey);
    assert.equal(claimedIdentity(`Nod-Identity ${named} 1 a b`), identity);
    assert.equal(claimedIdentity('Nod-Identity'), null);
    assert.equal(claimedIdentity('Nod-Identity !!! 1 a b'), null);
    assert.equal(
      claimedIdentity(`Nod-Identity ${toBase64Url(new Uint8Array(31))} 1 a b`),
      null,
    );
  });
});

describe('a cache bounded by size', () => {
  it('drops the least recently used entries once the sizes pass the cap', () => {
    const cache = createSizedCache<string>(10, (value) => value.length);
    cache.set('a', 'aaaa');
    cache.set('b', 'bbbb');
    assert.equal(cache.get('a'), 'aaaa');
    cache.set('c', 'cccc');
    assert.deepEqual(cache.keys(), ['a', 'c']);
    assert.equal(cache.bytes(), 8);
    cache.set('a', 'aaaaaa');
    assert.deepEqual(cache.keys(), ['c', 'a']);
    assert.equal(cache.bytes(), 10);
    cache.set('big', 'x'.repeat(11));
    assert.equal(cache.get('big'), undefined);
    assert.deepEqual(cache.keys(), ['c', 'a']);
    cache.delete('c');
    assert.equal(cache.bytes(), 6);
    assert.equal(cache.get('c'), undefined);
  });
});
