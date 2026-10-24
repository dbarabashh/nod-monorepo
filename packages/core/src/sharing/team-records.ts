import { randomBytes } from '@noble/ciphers/utils.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import {
  identityCard,
  parseIdentityCard,
  toHex,
  type Identity,
} from '../crypto/index.ts';
import {
  signRecord,
  type GrantedRole,
  type SignedAccessRecord,
} from './access-list.ts';
import {
  canWrite,
  type AccessState,
  type Invite,
} from './access-list-validator.ts';
import { inviteKeysOf, type InviteFile } from './invite.ts';
import {
  joinProof,
  keyChangeFor,
  newKeyId,
  newRootKey,
  sealJoinName,
  unwrapRootKey,
  wrapRootKey,
} from './team-keys.ts';

export type CurrentKey = { keyId: string; rootKey: Uint8Array };

export type Rotated = { record: SignedAccessRecord; rootKey: Uint8Array };

// The records a client writes, each with its wraps made for whoever the
// list says must get the key. What the list then makes of a record is the
// validator's decision, which the caller runs before sending it.
export function rootRecord(
  identity: Identity,
  at: number,
): Rotated & { keyId: string } {
  const keyId = newKeyId();
  const rootKey = newRootKey();
  const card = identityCard(identity);
  const record = signRecord(identity, null, at, {
    type: 'root',
    card,
    keyId,
    wrap: wrapRootKey(
      toHex(identity.wrappingPublicKey),
      rootKey,
      'root',
      keyId,
      '',
    ),
  });
  return { record, rootKey, keyId };
}

export function inviteRecord(
  identity: Identity,
  state: AccessState,
  key: CurrentKey,
  role: GrantedRole,
  approval: boolean,
  at: number,
): {
  record: SignedAccessRecord;
  signingKey: Uint8Array;
  wrappingKey: Uint8Array;
} {
  const signingKey = randomBytes(32);
  const wrappingKey = randomBytes(32);
  const wrappingPublicKey = toHex(x25519.getPublicKey(wrappingKey));
  const record = signRecord(identity, state.head, at, {
    type: 'invite',
    signingPublicKey: toHex(ed25519.getPublicKey(signingKey)),
    wrappingPublicKey,
    role,
    approval,
    wrap: approval
      ? null
      : wrapRootKey(
          wrappingPublicKey,
          key.rootKey,
          'invite',
          key.keyId,
          state.vaultId,
        ),
  });
  return { record, signingKey, wrappingKey };
}

export function inviteRevokeRecord(
  identity: Identity,
  state: AccessState,
  key: CurrentKey,
  invite: Invite,
  at: number,
): Rotated {
  const rotation = invite.approval
    ? null
    : keyChangeFor(state, 'inviteRevoke', key);
  return {
    record: signRecord(identity, state.head, at, {
      type: 'inviteRevoke',
      invite: invite.id,
      keyChange: rotation?.change ?? null,
    }),
    rootKey: rotation?.rootKey ?? key.rootKey,
  };
}

function inviterWrappingKey(file: InviteFile): Uint8Array {
  const inviter = parseIdentityCard(file.inviter);
  if (!inviter) {
    throw new Error('The invite names no inviter');
  }
  return inviter.wrappingPublicKey;
}

export function requestJoinRecord(
  identity: Identity,
  file: InviteFile,
  name: string | null,
  at: number,
): SignedAccessRecord {
  const { signingKey } = inviteKeysOf(file);
  return signRecord(identity, null, at, {
    type: 'requestJoin',
    invite: file.invite,
    card: identityCard(identity),
    proof: joinProof(signingKey, identity, file.invite),
    name: name === null ? null : sealJoinName(inviterWrappingKey(file), name),
  });
}

// Joining without approval: the key comes out of the invite file, where the
// inviter copied the invite record's wrap, and goes back into the list
// wrapped for this identity.
export function inviteJoinRecord(
  identity: Identity,
  file: InviteFile,
  name: string | null,
  at: number,
): Rotated {
  const { signingKey, wrappingKey } = inviteKeysOf(file);
  const rootKey = file.key
    ? unwrapRootKey(
        wrappingKey,
        toHex(x25519.getPublicKey(wrappingKey)),
        file.key.wrap,
        'invite',
        file.key.keyId,
        file.vaultId,
      )
    : null;
  if (!file.key || !rootKey) {
    throw new Error('The invite’s key could not be opened');
  }
  const { keyId } = file.key;
  return {
    record: signRecord(identity, null, at, {
      type: 'inviteJoin',
      invite: file.invite,
      card: identityCard(identity),
      proof: joinProof(signingKey, identity, file.invite),
      wrap: wrapRootKey(
        toHex(identity.wrappingPublicKey),
        rootKey,
        'inviteJoin',
        keyId,
        file.vaultId,
      ),
      name: name === null ? null : sealJoinName(inviterWrappingKey(file), name),
    }),
    rootKey,
  };
}

export function requestAcceptRecord(
  identity: Identity,
  state: AccessState,
  key: CurrentKey,
  requestId: string,
  role: GrantedRole,
  at: number,
): SignedAccessRecord {
  const request = state.requests[requestId];
  if (!request) {
    throw new Error('No such request');
  }
  return signRecord(identity, state.head, at, {
    type: 'requestAccept',
    request: requestId,
    role,
    wrap: wrapRootKey(
      request.wrappingPublicKey,
      key.rootKey,
      'requestAccept',
      key.keyId,
      state.vaultId,
    ),
  });
}

export function requestDeclineRecord(
  identity: Identity,
  state: AccessState,
  requestId: string,
  at: number,
): SignedAccessRecord {
  return signRecord(identity, state.head, at, {
    type: 'requestDecline',
    request: requestId,
  });
}

export function accountsAddRecord(
  identity: Identity,
  state: AccessState,
  key: CurrentKey,
  accounts: Array<{ card: string; role: GrantedRole }>,
  at: number,
): SignedAccessRecord {
  return signRecord(identity, state.head, at, {
    type: 'accountsAdd',
    accounts: accounts.map(({ card, role }) => {
      const parsed = parseIdentityCard(card);
      if (!parsed) {
        throw new Error('That is not an identity card');
      }
      return {
        card,
        role,
        wrap: wrapRootKey(
          toHex(parsed.wrappingPublicKey),
          key.rootKey,
          'accountsAdd',
          key.keyId,
          state.vaultId,
        ),
      };
    }),
  });
}

export function permissionChangesRecord(
  identity: Identity,
  state: AccessState,
  key: CurrentKey,
  changes: Array<{ identity: string; role: GrantedRole }>,
  at: number,
): Rotated {
  const takesWrite = changes.some(
    (change) =>
      canWrite(state.members[change.identity]?.role ?? null) &&
      !canWrite(change.role),
  );
  const rotation = takesWrite
    ? keyChangeFor(state, 'permissionChanges', key)
    : null;
  return {
    record: signRecord(identity, state.head, at, {
      type: 'permissionChanges',
      changes,
      keyChange: rotation?.change ?? null,
    }),
    rootKey: rotation?.rootKey ?? key.rootKey,
  };
}

export function accountsRemoveRecord(
  identity: Identity,
  state: AccessState,
  key: CurrentKey,
  identities: string[],
  at: number,
): Rotated {
  const rotation = keyChangeFor(
    state,
    'accountsRemove',
    key,
    (member) => !identities.includes(member),
  );
  return {
    record: signRecord(identity, state.head, at, {
      type: 'accountsRemove',
      identities,
      keyChange: rotation.change,
    }),
    rootKey: rotation.rootKey,
  };
}

export function keyChangeRecord(
  identity: Identity,
  state: AccessState,
  key: CurrentKey,
  at: number,
): Rotated {
  const rotation = keyChangeFor(state, 'keyChange', key);
  return {
    record: signRecord(identity, state.head, at, {
      type: 'keyChange',
      keyChange: rotation.change,
    }),
    rootKey: rotation.rootKey,
  };
}

export function requestRemoveRecord(
  identity: Identity,
  state: AccessState,
  at: number,
): SignedAccessRecord {
  return signRecord(identity, state.head, at, { type: 'requestRemove' });
}

export function ownerChangeRecord(
  identity: Identity,
  state: AccessState,
  owner: string,
  role: 'admin' | 'writer',
  at: number,
): SignedAccessRecord {
  return signRecord(identity, state.head, at, {
    type: 'ownerChange',
    owner,
    role,
  });
}
