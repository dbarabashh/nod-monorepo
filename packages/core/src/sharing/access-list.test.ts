import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  identityCard,
  identityHex,
  identityOf,
  toBase64Url,
  toHex,
  type Identity,
} from '../crypto/index.ts';
import {
  parseAccessRecord,
  parseAccessRecords,
  recordIdOf,
  recordJson,
  signRecord,
  teamVaultIdOf,
  type SignedAccessRecord,
} from './access-list.ts';
import {
  applyRecord,
  mayHaveManaged,
  mayHaveWritten,
  pendingRequests,
  replayAccessList,
  roleOf,
  startAccessList,
  type AccessState,
} from './access-list-validator.ts';
import { canonicalJson } from './canonical-json.ts';
import { signInviteFile, type InviteFile } from './invite.ts';
import {
  openJoinName,
  recoverTeamKeys,
  unwrapRootKey,
  wrapRootKey,
  type TeamKeys,
} from './team-keys.ts';
import {
  accountsAddRecord,
  accountsRemoveRecord,
  inviteJoinRecord,
  inviteRecord,
  inviteRevokeRecord,
  keyChangeRecord,
  ownerChangeRecord,
  permissionChangesRecord,
  requestAcceptRecord,
  requestDeclineRecord,
  requestJoinRecord,
  requestRemoveRecord,
  rootRecord,
  type CurrentKey,
} from './team-records.ts';

const owner = identityOf(new Uint8Array(32).fill(1));
const admin = identityOf(new Uint8Array(32).fill(2));
const writer = identityOf(new Uint8Array(32).fill(3));
const reader = identityOf(new Uint8Array(32).fill(4));
const stranger = identityOf(new Uint8Array(32).fill(5));
const hex = (identity: Identity) => identityHex(identity.publicKey);

// A card signed by one identity that names another's wrapping key: the
// card format allows it, since the signature covers only the signing key's
// possession.
function cardWithWrappingKey(by: Identity, wrapping: Identity): string {
  const forged: Identity = {
    ...by,
    wrappingKey: wrapping.wrappingKey,
    wrappingPublicKey: wrapping.wrappingPublicKey,
  };
  return identityCard(forged);
}

function accept(state: AccessState, record: SignedAccessRecord): AccessState {
  const next = applyRecord(state, record);
  assert.ok(next.ok, next.ok ? '' : next.reason);
  return next.state;
}

function refuse(
  state: AccessState,
  record: SignedAccessRecord,
  reason: RegExp,
) {
  const next = applyRecord(state, record);
  assert.ok(!next.ok, 'expected the record to be refused');
  assert.match(next.reason, reason);
}

function team() {
  const root = rootRecord(owner, 1);
  const vaultId = teamVaultIdOf(root.record);
  const started = startAccessList(vaultId, root.record);
  assert.ok(started.ok);
  let state = started.state;
  let key: CurrentKey = { keyId: root.keyId, rootKey: root.rootKey };
  const at = () => state.seen.length + 1;
  return {
    vaultId,
    get state() {
      return state;
    },
    get key() {
      return key;
    },
    add: (record: SignedAccessRecord, rootKey?: Uint8Array) => {
      state = accept(state, record);
      if (rootKey) {
        key = { keyId: state.generations.at(-1)?.keyId ?? '', rootKey };
      }
      return state;
    },
    addPeople: (
      by: Identity,
      people: Array<{
        identity: Identity;
        role: 'admin' | 'writer' | 'reader';
      }>,
    ) => {
      state = accept(
        state,
        accountsAddRecord(
          by,
          state,
          key,
          people.map(({ identity, role }) => ({
            card: identityCard(identity),
            role,
          })),
          at(),
        ),
      );
      return state;
    },
    at,
  };
}

function keysOf(state: AccessState, identity: Identity): TeamKeys {
  return recoverTeamKeys(state, identity);
}

describe('canonical json', () => {
  it('sorts keys, drops undefined and writes no spaces', () => {
    assert.equal(
      canonicalJson({ b: [1, 'x', null, { d: true, c: undefined }], a: 'é' }),
      '{"a":"é","b":[1,"x",null,{"d":true}]}',
    );
    assert.throws(() => canonicalJson({ a: Number.NaN }), /infinite/);
  });
});

describe('access records', () => {
  it('signs, hashes and parses back a record', () => {
    const { record } = rootRecord(owner, 1);
    assert.equal(record.id, recordIdOf(record));
    assert.match(record.id, /^[0-9a-f]{64}$/);
    const parsed = parseAccessRecord(
      JSON.parse(JSON.stringify(recordJson(record))),
    );
    assert.ok(parsed);
    assert.equal(parsed.id, record.id);
    assert.deepEqual(parsed.body, record.body);
    assert.equal(teamVaultIdOf(record), record.id.slice(0, 32));
  });

  it('refuses a record whose body, author or signature was changed', () => {
    const { record } = rootRecord(owner, 1);
    const json = recordJson(record);
    assert.equal(parseAccessRecord({ ...json, at: 2 }), null);
    assert.equal(parseAccessRecord({ ...json, author: hex(admin) }), null);
    assert.equal(
      parseAccessRecord({
        ...json,
        body: { ...record.body, keyId: '00'.repeat(16) },
      }),
      null,
    );
    assert.equal(
      parseAccessRecord({ ...json, signature: `${record.signature}A` }),
      null,
    );
    assert.equal(parseAccessRecord({ ...json, body: { type: 'nope' } }), null);
    assert.equal(parseAccessRecords([json, { ...json, at: 2 }]), null);
    assert.equal(parseAccessRecords([json])?.length, 1);
  });
});

describe('access list', () => {
  it('starts from a root signed by its owner, named after the record', () => {
    const { record } = rootRecord(owner, 1);
    const vaultId = teamVaultIdOf(record);
    const started = startAccessList(vaultId, record);
    assert.ok(started.ok);
    assert.equal(started.state.owner, hex(owner));
    assert.equal(roleOf(started.state, hex(owner)), 'owner');
    assert.equal(started.state.generations.length, 1);
    assert.ok(!startAccessList('00'.repeat(16), record).ok);
    const forged = signRecord(admin, null, 1, record.body);
    assert.ok(!startAccessList(teamVaultIdOf(forged), forged).ok);
    assert.ok(!replayAccessList(vaultId, []).ok);
  });

  it('lets only owners and admins manage, and only owners touch admins', () => {
    const t = team();
    refuse(
      t.state,
      accountsAddRecord(
        stranger,
        t.state,
        t.key,
        [{ card: identityCard(reader), role: 'reader' }],
        t.at(),
      ),
      /only an owner or admin adds/,
    );
    t.addPeople(owner, [
      { identity: admin, role: 'admin' },
      { identity: writer, role: 'writer' },
      { identity: reader, role: 'reader' },
    ]);
    assert.equal(roleOf(t.state, hex(admin)), 'admin');
    refuse(
      t.state,
      accountsAddRecord(
        admin,
        t.state,
        t.key,
        [{ card: identityCard(stranger), role: 'admin' }],
        t.at(),
      ),
      /only an owner makes admins/,
    );
    refuse(
      t.state,
      accountsAddRecord(
        admin,
        t.state,
        t.key,
        [{ card: identityCard(reader), role: 'reader' }],
        t.at(),
      ),
      /already a member/,
    );
    const other = identityOf(new Uint8Array(32).fill(6));
    t.addPeople(owner, [{ identity: other, role: 'admin' }]);
    refuse(
      t.state,
      permissionChangesRecord(
        admin,
        t.state,
        t.key,
        [{ identity: hex(other), role: 'reader' }],
        t.at(),
      ).record,
      /isn’t the author’s/,
    );
    refuse(
      t.state,
      accountsRemoveRecord(admin, t.state, t.key, [hex(owner)], t.at()).record,
      /isn’t the author’s/,
    );
    refuse(
      t.state,
      accountsRemoveRecord(owner, t.state, t.key, [hex(owner)], t.at()).record,
      /isn’t the author’s/,
    );
    t.add(
      accountsRemoveRecord(admin, t.state, t.key, [hex(reader)], t.at()).record,
    );
    assert.equal(roleOf(t.state, hex(reader)), null);
  });

  it('refuses a record that doesn’t follow the head, or comes twice', () => {
    const t = team();
    const first = accountsAddRecord(
      owner,
      t.state,
      t.key,
      [{ card: identityCard(writer), role: 'writer' }],
      2,
    );
    const stale = accountsAddRecord(
      owner,
      t.state,
      t.key,
      [{ card: identityCard(reader), role: 'reader' }],
      3,
    );
    t.add(first);
    refuse(t.state, stale, /doesn’t follow the head/);
    refuse(t.state, first, /already in the list/);
    refuse(
      t.state,
      signRecord(owner, t.state.head, 4, first.body),
      /already a member/,
    );
  });

  it('rotates the key when write permission is taken away, and the removed can’t follow', () => {
    const t = team();
    t.addPeople(owner, [
      { identity: writer, role: 'writer' },
      { identity: reader, role: 'reader' },
    ]);
    const firstKey = t.key;
    const writerKeys = keysOf(t.state, writer);
    assert.deepEqual(writerKeys.current?.rootKey, firstKey.rootKey);
    const demotion = permissionChangesRecord(
      owner,
      t.state,
      t.key,
      [{ identity: hex(writer), role: 'reader' }],
      t.at(),
    );
    assert.ok(demotion.record.body.type === 'permissionChanges');
    assert.ok(demotion.record.body.keyChange);
    refuse(
      t.state,
      signRecord(owner, t.state.head, t.at(), {
        ...demotion.record.body,
        keyChange: null,
      }),
      /rotates the key/,
    );
    t.add(demotion.record, demotion.rootKey);
    assert.equal(t.state.generations.length, 2);
    assert.notDeepEqual(t.key.rootKey, firstKey.rootKey);
    assert.equal(mayHaveWritten(t.state, hex(writer), firstKey.keyId), true);
    assert.equal(mayHaveWritten(t.state, hex(writer), t.key.keyId), false);
    assert.equal(mayHaveWritten(t.state, hex(reader), firstKey.keyId), false);
    assert.equal(mayHaveWritten(t.state, hex(owner), t.key.keyId), true);
    // A promotion within a generation needs no rotation and makes a writer.
    const promotion = permissionChangesRecord(
      owner,
      t.state,
      t.key,
      [{ identity: hex(reader), role: 'writer' }],
      t.at(),
    );
    assert.ok(
      promotion.record.body.type === 'permissionChanges' &&
        promotion.record.body.keyChange === null,
    );
    t.add(promotion.record);
    assert.equal(mayHaveWritten(t.state, hex(reader), t.key.keyId), true);

    const removal = accountsRemoveRecord(
      owner,
      t.state,
      t.key,
      [hex(reader)],
      t.at(),
    );
    t.add(removal.record, removal.rootKey);
    assert.equal(t.state.generations.length, 3);
    // Everyone who stays opens every generation; the removed opens only up to
    // their removal.
    const ownerKeys = keysOf(t.state, owner);
    assert.equal(ownerKeys.rootKeys.size, 3);
    assert.deepEqual(ownerKeys.rootKeys.get(firstKey.keyId), firstKey.rootKey);
    assert.deepEqual(ownerKeys.current?.rootKey, removal.rootKey);
    assert.deepEqual(ownerKeys.missing, []);
    const readerKeys = keysOf(t.state, reader);
    assert.equal(readerKeys.current, null);
    assert.equal(readerKeys.rootKeys.size, 2);
    assert.equal(readerKeys.missing.length, 1);
    assert.equal(readerKeys.missing[0]?.record, removal.record.id);
    const writerAfter = keysOf(t.state, writer);
    assert.deepEqual(writerAfter.current?.rootKey, removal.rootKey);
    assert.equal(writerAfter.rootKeys.size, 3);
  });

  it('refuses a rotation that leaves a member out or reuses a generation', () => {
    const t = team();
    t.addPeople(owner, [{ identity: writer, role: 'writer' }]);
    const rotation = keyChangeRecord(owner, t.state, t.key, t.at());
    assert.ok(rotation.record.body.type === 'keyChange');
    const { keyChange } = rotation.record.body;
    const [writerWrap] = Object.entries(keyChange.wraps).filter(
      ([recipient]) => recipient === toHex(writer.wrappingPublicKey),
    );
    assert.ok(writerWrap);
    const partial = { ...keyChange.wraps };
    delete partial[writerWrap[0]];
    refuse(
      t.state,
      signRecord(owner, t.state.head, t.at(), {
        type: 'keyChange',
        keyChange: { ...keyChange, wraps: partial },
      }),
      /every remaining member/,
    );
    refuse(
      t.state,
      signRecord(owner, t.state.head, t.at(), {
        type: 'keyChange',
        keyChange: { ...keyChange, keyId: t.key.keyId },
      }),
      /twice/,
    );
    refuse(
      t.state,
      signRecord(writer, t.state.head, t.at(), {
        type: 'keyChange',
        keyChange,
      }),
      /only an owner or admin rotates/,
    );
    t.add(rotation.record, rotation.rootKey);
    assert.deepEqual(
      keysOf(t.state, writer).current?.rootKey,
      rotation.rootKey,
    );
  });

  it('lets a person join through an approval invite once an admin accepts', () => {
    const t = team();
    t.addPeople(owner, [{ identity: admin, role: 'admin' }]);
    const invite = inviteRecord(admin, t.state, t.key, 'writer', true, t.at());
    assert.ok(invite.record.body.type === 'invite');
    assert.equal(invite.record.body.wrap, null);
    refuse(
      t.state,
      inviteRecord(admin, t.state, t.key, 'admin', true, t.at()).record,
      /only an owner invites admins/,
    );
    t.add(invite.record);
    const file: InviteFile = signInviteFile(admin, {
      team: 'Roadmap',
      inviter: identityCard(admin),
      vaultId: t.vaultId,
      invite: invite.record.id,
      signingKey: toHex(invite.signingKey),
      wrappingKey: toHex(invite.wrappingKey),
      role: 'writer',
      approval: true,
      key: null,
      host: 'https://sync.example.com/',
    });
    const request = requestJoinRecord(stranger, file, 'Sam', t.at());
    refuse(
      t.state,
      requestJoinRecord(
        stranger,
        { ...file, signingKey: toHex(new Uint8Array(32).fill(7)) },
        null,
        t.at(),
      ),
      /proof/,
    );
    refuse(
      t.state,
      signRecord(stranger, t.state.head, t.at(), request.body),
      /follows nothing/,
    );
    refuse(
      t.state,
      requestJoinRecord(owner, file, null, t.at()),
      /already a member/,
    );
    t.add(request);
    const [pending] = pendingRequests(t.state);
    assert.equal(pending?.identity, hex(stranger));
    assert.equal(pending && openJoinName(admin, pending.name ?? ''), 'Sam');
    assert.equal(pending && openJoinName(owner, pending.name ?? ''), null);
    refuse(
      t.state,
      requestJoinRecord(stranger, file, null, t.at()),
      /already waiting/,
    );
    refuse(
      t.state,
      requestAcceptRecord(owner, t.state, t.key, request.id, 'admin', t.at()),
      /higher than the invite/,
    );
    refuse(
      t.state,
      requestAcceptRecord(
        stranger,
        t.state,
        t.key,
        request.id,
        'writer',
        t.at(),
      ),
      /only an owner or admin answers/,
    );
    t.add(
      requestAcceptRecord(admin, t.state, t.key, request.id, 'reader', t.at()),
    );
    assert.equal(roleOf(t.state, hex(stranger)), 'reader');
    assert.equal(t.state.requests[request.id]?.status, 'accepted');
    assert.deepEqual(keysOf(t.state, stranger).current?.rootKey, t.key.rootKey);
    refuse(
      t.state,
      requestDeclineRecord(admin, t.state, request.id, t.at()),
      /no such pending request/,
    );
    // Removing someone rotates the key for the invite too, so a later
    // joiner through it gets the new key.
    const removal = accountsRemoveRecord(
      owner,
      t.state,
      t.key,
      [hex(stranger)],
      t.at(),
    );
    assert.ok(removal.record.body.type === 'accountsRemove');
    // The new key goes to members only: an approval invite's keys are in a
    // file anyone with the link opens, and an accept wraps the key itself.
    assert.ok(invite.record.body.type === 'invite');
    assert.equal(
      Object.keys(removal.record.body.keyChange.wraps).includes(
        invite.record.body.wrappingPublicKey,
      ),
      false,
    );
    t.add(removal.record, removal.rootKey);
    assert.equal(roleOf(t.state, hex(stranger)), null);
    assert.equal(t.state.invites[invite.record.id]?.revoked, false);
  });

  it('lets a person join through a no-approval invite, and retires it on removal', () => {
    const t = team();
    const invite = inviteRecord(owner, t.state, t.key, 'reader', false, t.at());
    assert.ok(invite.record.body.type === 'invite');
    assert.ok(invite.record.body.wrap);
    refuse(
      t.state,
      signRecord(owner, t.state.head, t.at(), {
        ...invite.record.body,
        wrap: null,
      }),
      /exactly when/,
    );
    t.add(invite.record);
    const file: InviteFile = signInviteFile(owner, {
      team: 'Roadmap',
      inviter: identityCard(owner),
      vaultId: t.vaultId,
      invite: invite.record.id,
      signingKey: toHex(invite.signingKey),
      wrappingKey: toHex(invite.wrappingKey),
      role: 'reader',
      approval: false,
      key:
        invite.record.body.wrap === null
          ? null
          : { wrap: invite.record.body.wrap, keyId: t.key.keyId },
      host: 'https://sync.example.com/',
    });
    const stored = t.state.invites[invite.record.id];
    assert.ok(stored);
    assert.ok(
      unwrapRootKey(
        invite.wrappingKey,
        stored.wrappingPublicKey,
        stored.wrap ?? '',
        'invite',
        t.key.keyId,
        t.vaultId,
      ),
    );
    refuse(
      t.state,
      requestJoinRecord(stranger, file, null, t.at()),
      /other way/,
    );
    const joined = inviteJoinRecord(stranger, file, 'Sam', t.at());
    const late = inviteJoinRecord(reader, file, null, 99);
    assert.deepEqual(joined.rootKey, t.key.rootKey);
    t.add(joined.record);
    assert.equal(roleOf(t.state, hex(stranger)), 'reader');
    assert.deepEqual(keysOf(t.state, stranger).current?.rootKey, t.key.rootKey);
    assert.equal(mayHaveWritten(t.state, hex(stranger), t.key.keyId), false);

    const revoke = inviteRevokeRecord(owner, t.state, t.key, stored, t.at());
    assert.ok(revoke.record.body.type === 'inviteRevoke');
    assert.ok(revoke.record.body.keyChange);
    assert.equal(
      revoke.record.body.keyChange.wraps[stored.wrappingPublicKey],
      undefined,
    );
    refuse(
      t.state,
      signRecord(owner, t.state.head, t.at(), {
        ...revoke.record.body,
        keyChange: null,
      }),
      /rotates the key/,
    );
    t.add(revoke.record, revoke.rootKey);
    assert.equal(t.state.invites[invite.record.id]?.revoked, true);
    refuse(t.state, late.record, /no such live invite/);
    assert.throws(
      () =>
        inviteJoinRecord(
          reader,
          { ...file, key: { wrap: file.key?.wrap ?? '', keyId: t.key.keyId } },
          null,
          t.at(),
        ),
      /could not be opened/,
    );

    const again = inviteRecord(owner, t.state, t.key, 'writer', false, t.at());
    t.add(again.record);
    const removal = accountsRemoveRecord(
      owner,
      t.state,
      t.key,
      [hex(stranger)],
      t.at(),
    );
    t.add(removal.record, removal.rootKey);
    assert.equal(t.state.invites[again.record.id]?.revoked, true);
  });

  it('lets a member ask to leave and the owner hand the team over', () => {
    const t = team();
    t.addPeople(owner, [{ identity: writer, role: 'writer' }]);
    refuse(
      t.state,
      requestRemoveRecord(owner, t.state, t.at()),
      /isn’t the owner/,
    );
    refuse(
      t.state,
      requestRemoveRecord(stranger, t.state, t.at()),
      /isn’t the owner/,
    );
    t.add(requestRemoveRecord(writer, t.state, t.at()));
    assert.equal(t.state.members[hex(writer)]?.leaving, true);
    assert.equal(roleOf(t.state, hex(writer)), 'writer');
    refuse(
      t.state,
      ownerChangeRecord(writer, t.state, hex(writer), 'writer', t.at()),
      /only the owner/,
    );
    refuse(
      t.state,
      ownerChangeRecord(owner, t.state, hex(stranger), 'writer', t.at()),
      /another member/,
    );
    t.add(ownerChangeRecord(owner, t.state, hex(writer), 'admin', t.at()));
    assert.equal(t.state.owner, hex(writer));
    assert.equal(roleOf(t.state, hex(writer)), 'owner');
    assert.equal(roleOf(t.state, hex(owner)), 'admin');
    const removal = accountsRemoveRecord(
      writer,
      t.state,
      t.key,
      [hex(owner)],
      t.at(),
    );
    t.add(removal.record, removal.rootKey);
    assert.equal(roleOf(t.state, hex(owner)), null);
  });

  it('refuses a card or an invite that reuses a wrapping key already in the team', () => {
    const t = team();
    t.addPeople(owner, [{ identity: writer, role: 'writer' }]);
    // A card proves only its signing key; one that names the writer's
    // wrapping key would replace their wrap with one nobody opens.
    const forgedCard = cardWithWrappingKey(stranger, writer);
    refuse(
      t.state,
      accountsAddRecord(
        owner,
        t.state,
        t.key,
        [{ card: forgedCard, role: 'reader' }],
        t.at(),
      ),
      /wrapping key already belongs/,
    );
    const invite = inviteRecord(owner, t.state, t.key, 'reader', false, t.at());
    t.add(invite.record);
    assert.ok(invite.record.body.type === 'invite');
    const file: InviteFile = signInviteFile(owner, {
      team: 'Roadmap',
      inviter: identityCard(owner),
      vaultId: t.vaultId,
      invite: invite.record.id,
      signingKey: toHex(invite.signingKey),
      wrappingKey: toHex(invite.wrappingKey),
      role: 'reader',
      approval: false,
      key:
        invite.record.body.wrap === null
          ? null
          : { wrap: invite.record.body.wrap, keyId: t.key.keyId },
      host: 'https://sync.example.com/',
    });
    const joined = inviteJoinRecord(stranger, file, null, t.at());
    assert.ok(joined.record.body.type === 'inviteJoin');
    refuse(
      t.state,
      signRecord(stranger, null, t.at(), {
        ...joined.record.body,
        card: forgedCard,
      }),
      /wrapping key already belongs/,
    );
    const before = keysOf(t.state, writer);
    assert.ok(before.current);
    refuse(
      t.state,
      signRecord(owner, t.state.head, t.at(), {
        type: 'invite',
        signingPublicKey: '03'.repeat(32),
        wrappingPublicKey: toHex(writer.wrappingPublicKey),
        role: 'reader',
        approval: true,
        wrap: null,
      }),
      /keys are its own/,
    );
  });

  it('retires no-approval invites on every rotation, and refuses accepting through a revoked one', () => {
    const t = team();
    t.addPeople(owner, [
      { identity: writer, role: 'writer' },
      { identity: admin, role: 'admin' },
    ]);
    const open = inviteRecord(owner, t.state, t.key, 'reader', false, t.at());
    t.add(open.record);
    const asked = inviteRecord(owner, t.state, t.key, 'writer', true, t.at());
    t.add(asked.record);
    const demotion = permissionChangesRecord(
      owner,
      t.state,
      t.key,
      [{ identity: hex(writer), role: 'reader' }],
      t.at(),
    );
    t.add(demotion.record, demotion.rootKey);
    assert.equal(t.state.invites[open.record.id]?.revoked, true);
    assert.equal(t.state.invites[asked.record.id]?.revoked, false);
    assert.ok(demotion.record.body.type === 'permissionChanges');
    assert.deepEqual(
      Object.keys(demotion.record.body.keyChange?.wraps ?? {}).sort(),
      [
        toHex(owner.wrappingPublicKey),
        toHex(writer.wrappingPublicKey),
        toHex(admin.wrappingPublicKey),
      ].sort(),
    );
    const file: InviteFile = signInviteFile(owner, {
      team: 'Roadmap',
      inviter: identityCard(owner),
      vaultId: t.vaultId,
      invite: asked.record.id,
      signingKey: toHex(asked.signingKey),
      wrappingKey: toHex(asked.wrappingKey),
      role: 'writer',
      approval: true,
      key: null,
      host: 'https://sync.example.com/',
    });
    const request = requestJoinRecord(stranger, file, null, t.at());
    t.add(request);
    const stored = t.state.invites[asked.record.id];
    assert.ok(stored);
    const revoke = inviteRevokeRecord(owner, t.state, t.key, stored, t.at());
    t.add(revoke.record, revoke.rootKey);
    refuse(
      t.state,
      requestAcceptRecord(owner, t.state, t.key, request.id, 'writer', t.at()),
      /no such live invite/,
    );
    // A promotion in the same record as a demotion counts for the new
    // generation only, which is the one it can write under.
    const both = permissionChangesRecord(
      owner,
      t.state,
      t.key,
      [
        { identity: hex(writer), role: 'writer' },
        { identity: hex(admin), role: 'reader' },
      ],
      t.at(),
    );
    const oldKeyId = t.key.keyId;
    t.add(both.record, both.rootKey);
    assert.equal(mayHaveWritten(t.state, hex(writer), oldKeyId), false);
    assert.equal(mayHaveWritten(t.state, hex(writer), t.key.keyId), true);
    assert.equal(mayHaveWritten(t.state, hex(admin), oldKeyId), true);
    assert.equal(mayHaveWritten(t.state, hex(admin), t.key.keyId), false);
    assert.equal(mayHaveManaged(t.state, hex(admin), oldKeyId), true);
    assert.equal(mayHaveManaged(t.state, hex(admin), t.key.keyId), false);
    assert.equal(mayHaveManaged(t.state, hex(writer), t.key.keyId), false);
  });

  it('refuses a rotation wrapped for someone outside the team', () => {
    const t = team();
    t.addPeople(owner, [{ identity: writer, role: 'writer' }]);
    const rotation = keyChangeRecord(owner, t.state, t.key, t.at());
    assert.ok(rotation.record.body.type === 'keyChange');
    const { keyChange } = rotation.record.body;
    refuse(
      t.state,
      signRecord(owner, t.state.head, t.at(), {
        type: 'keyChange',
        keyChange: {
          ...keyChange,
          wraps: {
            ...keyChange.wraps,
            [toHex(stranger.wrappingPublicKey)]: 'AAAA',
          },
        },
      }),
      /isn’t in the team/,
    );
  });

  it('refuses a key change that wraps the new key for an invite, and a second request to leave', () => {
    const t = team();
    t.addPeople(owner, [{ identity: writer, role: 'writer' }]);
    const asked = inviteRecord(owner, t.state, t.key, 'reader', true, t.at());
    t.add(asked.record);
    assert.ok(asked.record.body.type === 'invite');
    const rotation = keyChangeRecord(owner, t.state, t.key, t.at());
    assert.ok(rotation.record.body.type === 'keyChange');
    const { keyChange } = rotation.record.body;
    refuse(
      t.state,
      signRecord(owner, t.state.head, t.at(), {
        type: 'keyChange',
        keyChange: {
          ...keyChange,
          wraps: {
            ...keyChange.wraps,
            [asked.record.body.wrappingPublicKey]: 'AAAA',
          },
        },
      }),
      /isn’t in the team/,
    );
    t.add(requestRemoveRecord(writer, t.state, t.at()));
    refuse(
      t.state,
      requestRemoveRecord(writer, t.state, t.at()),
      /already asked to leave/,
    );
  });

  it('refuses a wrap or a chain that isn’t the size of one', () => {
    const { record } = rootRecord(owner, 1);
    assert.ok(record.body.type === 'root');
    const json = recordJson(record);
    const long = toBase64Url(new Uint8Array(3000));
    const forged = signRecord(owner, null, 1, { ...record.body, wrap: long });
    assert.equal(parseAccessRecord(recordJson(forged)), null);
    assert.ok(parseAccessRecord(json));
    const t = team();
    const rotation = keyChangeRecord(owner, t.state, t.key, t.at());
    assert.ok(rotation.record.body.type === 'keyChange');
    const padded = signRecord(owner, t.state.head, t.at(), {
      type: 'keyChange',
      keyChange: { ...rotation.record.body.keyChange, chain: long },
    });
    assert.equal(parseAccessRecord(recordJson(padded)), null);
    assert.ok(parseAccessRecord(recordJson(rotation.record)));
  });

  it('refuses a record whose signature is spelled another way', () => {
    const { record } = rootRecord(owner, 1);
    const json = recordJson(record);
    const last = record.signature.at(-1) ?? 'A';
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const index = alphabet.indexOf(last);
    // A 64-byte signature ends in a character carrying two bits; the next
    // one with the same two bits decodes to the same bytes.
    const other = alphabet[(index & ~15) | ((index + 1) & 15)] ?? 'A';
    const respelled = `${record.signature.slice(0, -1)}${other}`;
    assert.notEqual(respelled, record.signature);
    assert.equal(parseAccessRecord({ ...json, signature: respelled }), null);
    assert.ok(parseAccessRecord(json));
  });

  it('opens no key whose chain doesn’t lead back to the generation before', () => {
    const t = team();
    t.addPeople(owner, [{ identity: writer, role: 'writer' }]);
    const before = t.key;
    const honest = keyChangeRecord(owner, t.state, t.key, t.at());
    assert.ok(honest.record.body.type === 'keyChange');
    // The admin wraps a key of their own for the writer, with the honest
    // chain, so it opens but leads nowhere.
    const forged = {
      ...honest.record.body.keyChange,
      wraps: {
        ...honest.record.body.keyChange.wraps,
        [toHex(writer.wrappingPublicKey)]: wrapRootKey(
          toHex(writer.wrappingPublicKey),
          new Uint8Array(32).fill(9),
          'keyChange',
          honest.record.body.keyChange.keyId,
          t.vaultId,
        ),
      },
    };
    t.add(
      signRecord(owner, t.state.head, t.at(), {
        type: 'keyChange',
        keyChange: forged,
      }),
    );
    const writerKeys = keysOf(t.state, writer);
    assert.equal(writerKeys.current, null);
    assert.equal(writerKeys.missing[0]?.keyId, forged.keyId);
    assert.deepEqual(writerKeys.rootKeys.get(before.keyId), before.rootKey);
    assert.ok(keysOf(t.state, owner).current);
  });

  it('replays a whole list to the same state', () => {
    const t = team();
    t.addPeople(owner, [{ identity: writer, role: 'writer' }]);
    const rotation = keyChangeRecord(owner, t.state, t.key, t.at());
    t.add(rotation.record, rotation.rootKey);
    const records: SignedAccessRecord[] = [];
    const root = rootRecord(owner, 1);
    const vaultId = teamVaultIdOf(root.record);
    records.push(root.record);
    let state = startAccessList(vaultId, root.record);
    assert.ok(state.ok);
    const add = accountsAddRecord(
      owner,
      state.state,
      { keyId: root.keyId, rootKey: root.rootKey },
      [{ card: identityCard(writer), role: 'writer' }],
      2,
    );
    records.push(add);
    state = applyRecord(state.state, add);
    assert.ok(state.ok);
    const replayed = replayAccessList(vaultId, records);
    assert.ok(replayed.ok);
    assert.deepEqual(replayed.state, state.state);
    assert.ok(!replayAccessList(vaultId, [add, root.record]).ok);
    assert.ok(!replayAccessList(vaultId, [root.record, add, add]).ok);
  });
});
