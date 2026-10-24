import {
  bytesOf,
  fromBase64Url,
  fromHex,
  identityHex,
  parseIdentityCard,
  toHex,
  verify,
} from '../crypto/index.ts';
import {
  joinTypes,
  teamVaultIdOf,
  type GrantedRole,
  type KeyChange,
  type RecordType,
  type Role,
  type SignedAccessRecord,
} from './access-list.ts';

export type Member = {
  identity: string;
  card: string;
  wrappingPublicKey: string;
  role: Role;
  leaving: boolean;
  // The name a joiner chose, sealed for their inviter alone.
  name: string | null;
};

export type Invite = {
  id: string;
  signingPublicKey: string;
  wrappingPublicKey: string;
  role: GrantedRole;
  approval: boolean;
  wrap: string | null;
  revoked: boolean;
};

export type JoinRequest = {
  id: string;
  identity: string;
  card: string;
  wrappingPublicKey: string;
  invite: string;
  name: string | null;
  status: 'pending' | 'accepted' | 'declined';
};

// The root key of one generation, as the list hands it out: wrapped for
// each recipient by the record that let them in or rotated the key, and the
// previous generation's key sealed under this one.
export type Generation = {
  keyId: string;
  record: string;
  // Everyone who could write, and everyone who could manage, while this
  // generation was current. Taking a right away rotates the key, so the
  // sets only grow.
  writers: string[];
  managers: string[];
  wraps: Record<string, { wrapped: string; type: RecordType }>;
  chain: string | null;
};

export type AccessState = {
  vaultId: string;
  head: string;
  owner: string;
  members: Record<string, Member>;
  invites: Record<string, Invite>;
  requests: Record<string, JoinRequest>;
  generations: Generation[];
  seen: string[];
};

export type Validation =
  | { ok: true; state: AccessState }
  | { ok: false; reason: string };

export const maxPendingPerInvite = 32;

export const roleRank: Record<Role, number> = {
  reader: 0,
  writer: 1,
  admin: 2,
  owner: 3,
};
const rank = roleRank;

export function canWrite(role: Role | null): boolean {
  return role !== null && rank[role] >= rank.writer;
}

export function canManage(role: Role | null): boolean {
  return role !== null && rank[role] >= rank.admin;
}

export function roleOf(state: AccessState, identity: string): Role | null {
  return state.members[identity]?.role ?? null;
}

export function currentGeneration(state: AccessState): Generation {
  const current = state.generations.at(-1);
  if (!current) {
    throw new Error('An access list has at least one key generation');
  }
  return current;
}

export function generationOf(
  state: AccessState,
  keyId: string,
): Generation | undefined {
  return state.generations.find((generation) => generation.keyId === keyId);
}

// Whether a file sealed under this generation by this identity is read: the
// publisher could write while the generation was current.
export function mayHaveWritten(
  state: AccessState,
  identity: string,
  keyId: string,
): boolean {
  return generationOf(state, keyId)?.writers.includes(identity) ?? false;
}

export function mayHaveManaged(
  state: AccessState,
  identity: string,
  keyId: string,
): boolean {
  return generationOf(state, keyId)?.managers.includes(identity) ?? false;
}

export function liveInvites(state: AccessState): Invite[] {
  return Object.values(state.invites).filter((invite) => !invite.revoked);
}

export function pendingRequests(state: AccessState): JoinRequest[] {
  return Object.values(state.requests).filter(
    (request) => request.status === 'pending',
  );
}

const refuse = (reason: string): Validation => ({ ok: false, reason });

function cardOf(
  card: string,
): { identity: string; wrappingPublicKey: string } | null {
  const parsed = parseIdentityCard(card);
  return parsed
    ? {
        identity: identityHex(parsed.publicKey),
        wrappingPublicKey: toHex(parsed.wrappingPublicKey),
      }
    : null;
}

function joinProofHolds(
  invite: Invite,
  identity: string,
  proof: string,
): boolean {
  try {
    return verify(
      fromHex(invite.signingPublicKey),
      fromBase64Url(proof),
      'nod:sig:join:v1',
      [fromHex(identity), bytesOf(invite.id)],
    );
  } catch {
    return false;
  }
}

function clone(state: AccessState): AccessState {
  return {
    ...state,
    members: { ...state.members },
    invites: { ...state.invites },
    requests: { ...state.requests },
    generations: state.generations.map((generation) => ({
      ...generation,
      writers: [...generation.writers],
      managers: [...generation.managers],
      wraps: { ...generation.wraps },
    })),
    seen: [...state.seen],
  };
}

function membersWith(
  state: AccessState,
  may: (role: Role | null) => boolean,
): string[] {
  return Object.values(state.members)
    .filter((member) => may(member.role))
    .map((member) => member.identity);
}

function noteWriter(state: AccessState, identity: string) {
  const current = currentGeneration(state);
  const role = roleOf(state, identity);
  if (canWrite(role) && !current.writers.includes(identity)) {
    current.writers.push(identity);
  }
  if (canManage(role) && !current.managers.includes(identity)) {
    current.managers.push(identity);
  }
}

// A wrapping key names one recipient in a generation: a card that reuses a
// member's or an invite's wrapping key (a card proves only the signing key)
// could otherwise replace their wrap with one that opens for nobody.
function wrappingKeyTaken(state: AccessState, wrappingPublicKey: string) {
  return (
    Object.values(state.members).some(
      (member) => member.wrappingPublicKey === wrappingPublicKey,
    ) ||
    liveInvites(state).some(
      (invite) => invite.wrappingPublicKey === wrappingPublicKey,
    )
  );
}

function noteWrap(
  state: AccessState,
  recipient: string,
  wrapped: string,
  type: RecordType,
): string | null {
  const current = currentGeneration(state);
  if (current.wraps[recipient]) {
    return 'this generation already wraps the key for that recipient';
  }
  current.wraps[recipient] = { wrapped, type };
  return null;
}

// Everyone who stays gets the new key, and nobody else; what each wrap holds
// the validator can't see.
function rotate(
  state: AccessState,
  change: KeyChange,
  record: SignedAccessRecord,
): string | null {
  if (
    state.generations.some((generation) => generation.keyId === change.keyId)
  ) {
    return 'a key generation can’t be introduced twice';
  }
  // A no-approval invite wraps the key its record was made under, which is
  // no longer the current one, so every rotation retires them.
  retireNoApprovalInvites(state);
  const recipients = new Set(Object.keys(change.wraps));
  const expected = new Set(
    Object.values(state.members).map((member) => member.wrappingPublicKey),
  );
  if ([...expected].some((recipient) => !recipients.has(recipient))) {
    return 'the new key isn’t wrapped for every remaining member';
  }
  if ([...recipients].some((recipient) => !expected.has(recipient))) {
    return 'the new key is wrapped for someone who isn’t in the team';
  }
  state.generations.push({
    keyId: change.keyId,
    record: record.id,
    writers: membersWith(state, canWrite),
    managers: membersWith(state, canManage),
    wraps: Object.fromEntries(
      Object.entries(change.wraps).map(([recipient, wrapped]) => [
        recipient,
        { wrapped, type: record.body.type },
      ]),
    ),
    chain: change.chain,
  });
  return null;
}

function addMember(
  state: AccessState,
  card: string,
  role: Role,
  wrap: string | null,
  type: RecordType,
  name: string | null = null,
): string | null {
  const parsed = cardOf(card);
  if (!parsed) {
    return 'an identity card doesn’t verify';
  }
  if (state.members[parsed.identity]) {
    return 'already a member';
  }
  if (wrappingKeyTaken(state, parsed.wrappingPublicKey)) {
    return 'that wrapping key already belongs to someone in the team';
  }
  state.members[parsed.identity] = {
    identity: parsed.identity,
    card,
    wrappingPublicKey: parsed.wrappingPublicKey,
    role,
    leaving: false,
    name,
  };
  noteWriter(state, parsed.identity);
  return wrap === null
    ? null
    : noteWrap(state, parsed.wrappingPublicKey, wrap, type);
}

// Owners and admins manage members and invites; only an owner touches an
// admin, and admins can't touch each other.
function mayGrant(by: Role, role: GrantedRole): boolean {
  return role !== 'admin' || by === 'owner';
}

function mayTouch(by: Role, target: Member): boolean {
  return target.role !== 'owner' && (by === 'owner' || !canManage(target.role));
}

function retireNoApprovalInvites(state: AccessState) {
  for (const invite of Object.values(state.invites)) {
    if (!invite.approval) {
      state.invites[invite.id] = { ...invite, revoked: true };
    }
  }
}

function apply(
  state: AccessState,
  record: SignedAccessRecord,
  author: Role | null,
): string | null {
  const { body } = record;
  switch (body.type) {
    case 'root':
      return 'a list has one root';
    case 'invite': {
      if (!author || !canManage(author) || !mayGrant(author, body.role)) {
        return 'only an owner or admin invites, and only an owner invites admins';
      }
      if (body.approval ? body.wrap !== null : body.wrap === null) {
        return 'an invite wraps the key exactly when joining needs no approval';
      }
      if (
        Object.values(state.invites).some(
          (invite) =>
            invite.signingPublicKey === body.signingPublicKey ||
            invite.wrappingPublicKey === body.wrappingPublicKey,
        ) ||
        wrappingKeyTaken(state, body.wrappingPublicKey)
      ) {
        return 'an invite’s keys are its own';
      }
      state.invites[record.id] = {
        id: record.id,
        signingPublicKey: body.signingPublicKey,
        wrappingPublicKey: body.wrappingPublicKey,
        role: body.role,
        approval: body.approval,
        wrap: body.wrap,
        revoked: false,
      };
      return body.wrap === null
        ? null
        : noteWrap(state, body.wrappingPublicKey, body.wrap, 'invite');
    }
    case 'inviteRevoke': {
      const invite = state.invites[body.invite];
      if (!author || !canManage(author)) {
        return 'only an owner or admin revokes an invite';
      }
      if (!invite || invite.revoked) {
        return 'no such live invite';
      }
      if (!invite.approval && !body.keyChange) {
        return 'revoking an invite that needs no approval rotates the key';
      }
      state.invites[invite.id] = { ...invite, revoked: true };
      return body.keyChange ? rotate(state, body.keyChange, record) : null;
    }
    case 'requestJoin':
    case 'inviteJoin': {
      const invite = state.invites[body.invite];
      const parsed = cardOf(body.card);
      if (author !== null) {
        return 'already a member';
      }
      if (!invite || invite.revoked) {
        return 'no such live invite';
      }
      if (invite.approval !== (body.type === 'requestJoin')) {
        return 'this invite joins the other way';
      }
      if (!parsed || parsed.identity !== record.author) {
        return 'the card isn’t the author’s';
      }
      if (!joinProofHolds(invite, record.author, body.proof)) {
        return 'the join proof doesn’t hold';
      }
      if (body.type === 'inviteJoin') {
        return addMember(
          state,
          body.card,
          invite.role,
          body.wrap,
          body.type,
          body.name,
        );
      }
      const pending = pendingRequests(state).filter(
        (request) => request.invite === invite.id,
      );
      if (pending.some((request) => request.identity === record.author)) {
        return 'a request from this person is already waiting';
      }
      if (pending.length >= maxPendingPerInvite) {
        return 'too many requests wait on this invite';
      }
      state.requests[record.id] = {
        id: record.id,
        identity: parsed.identity,
        card: body.card,
        wrappingPublicKey: parsed.wrappingPublicKey,
        invite: invite.id,
        name: body.name,
        status: 'pending',
      };
      return null;
    }
    case 'requestAccept':
    case 'requestDecline': {
      const request = state.requests[body.request];
      if (!author || !canManage(author)) {
        return 'only an owner or admin answers a request';
      }
      if (!request || request.status !== 'pending') {
        return 'no such pending request';
      }
      if (body.type === 'requestDecline') {
        state.requests[request.id] = { ...request, status: 'declined' };
        return null;
      }
      const invite = state.invites[request.invite];
      if (!invite || invite.revoked) {
        return 'no such live invite';
      }
      if (rank[body.role] > rank[invite.role] || !mayGrant(author, body.role)) {
        return 'the role is higher than the invite allows';
      }
      const failed = addMember(
        state,
        request.card,
        body.role,
        body.wrap,
        body.type,
        request.name,
      );
      if (failed) {
        return failed;
      }
      state.requests[request.id] = { ...request, status: 'accepted' };
      return null;
    }
    case 'accountsAdd': {
      if (!author || !canManage(author)) {
        return 'only an owner or admin adds people';
      }
      for (const account of body.accounts) {
        if (!mayGrant(author, account.role)) {
          return 'only an owner makes admins';
        }
        const failed = addMember(
          state,
          account.card,
          account.role,
          account.wrap,
          body.type,
        );
        if (failed) {
          return failed;
        }
      }
      return null;
    }
    case 'permissionChanges': {
      if (!author || !canManage(author)) {
        return 'only an owner or admin changes roles';
      }
      let takesWrite = false;
      for (const change of body.changes) {
        const member = state.members[change.identity];
        if (
          !member ||
          !mayTouch(author, member) ||
          !mayGrant(author, change.role)
        ) {
          return 'that role change isn’t the author’s to make';
        }
        if (canWrite(member.role) && !canWrite(change.role)) {
          takesWrite = true;
        }
        state.members[change.identity] = { ...member, role: change.role };
      }
      if (takesWrite && !body.keyChange) {
        return 'taking write permission away rotates the key';
      }
      if (body.keyChange) {
        return rotate(state, body.keyChange, record);
      }
      for (const change of body.changes) {
        noteWriter(state, change.identity);
      }
      return null;
    }
    case 'accountsRemove': {
      if (!author || !canManage(author)) {
        return 'only an owner or admin removes people';
      }
      for (const identity of body.identities) {
        const member = state.members[identity];
        if (!member || !mayTouch(author, member)) {
          return 'that removal isn’t the author’s to make';
        }
        delete state.members[identity];
      }
      return rotate(state, body.keyChange, record);
    }
    case 'keyChange':
      if (!author || !canManage(author)) {
        return 'only an owner or admin rotates the key';
      }
      return rotate(state, body.keyChange, record);
    case 'requestRemove': {
      const member = state.members[record.author];
      if (!member || member.role === 'owner') {
        return 'only a member who isn’t the owner asks to leave';
      }
      // Asked once is enough: a repeat would only grow the list, which any
      // member could otherwise fill until nobody can be removed.
      if (member.leaving) {
        return 'this member already asked to leave';
      }
      state.members[record.author] = { ...member, leaving: true };
      return null;
    }
    case 'ownerChange': {
      const next = state.members[body.owner];
      const old = state.members[record.author];
      if (author !== 'owner' || !old) {
        return 'only the owner hands the team over';
      }
      if (!next || body.owner === record.author) {
        return 'the new owner must be another member';
      }
      state.owner = body.owner;
      state.members[body.owner] = { ...next, role: 'owner', leaving: false };
      state.members[record.author] = { ...old, role: body.role };
      noteWriter(state, body.owner);
      noteWriter(state, record.author);
      return null;
    }
    default:
      return 'unknown record';
  }
}

// The first record: names the owner and wraps the key for them, and gives
// the vault its id.
export function startAccessList(
  vaultId: string,
  root: SignedAccessRecord,
): Validation {
  const { body } = root;
  if (body.type !== 'root') {
    return refuse('a list starts with its root');
  }
  if (root.prev !== null) {
    return refuse('the root follows nothing');
  }
  if (teamVaultIdOf(root) !== vaultId) {
    return refuse('the root isn’t this vault’s');
  }
  const owner = cardOf(body.card);
  if (!owner || owner.identity !== root.author) {
    return refuse('the root is signed by someone other than its owner');
  }
  return {
    ok: true,
    state: {
      vaultId,
      head: root.id,
      owner: owner.identity,
      members: {
        [owner.identity]: {
          identity: owner.identity,
          card: body.card,
          wrappingPublicKey: owner.wrappingPublicKey,
          role: 'owner',
          leaving: false,
          name: null,
        },
      },
      invites: {},
      requests: {},
      generations: [
        {
          keyId: body.keyId,
          record: root.id,
          writers: [owner.identity],
          managers: [owner.identity],
          wraps: {
            [owner.wrappingPublicKey]: { wrapped: body.wrap, type: 'root' },
          },
          chain: null,
        },
      ],
      seen: [root.id],
    },
  };
}

// Every record but a join names the head it follows (compare-and-append); a
// join record follows nothing and is taken once, wherever the relay filed
// it. Writes into `state`; a refusal leaves it half-applied, so callers work
// on a copy they can drop.
function applyInto(
  state: AccessState,
  record: SignedAccessRecord,
  seen: Set<string>,
): string | null {
  if (seen.has(record.id)) {
    return 'this record is already in the list';
  }
  const joining = joinTypes.includes(record.body.type);
  if (joining ? record.prev !== null : record.prev !== state.head) {
    return joining
      ? 'a join record follows nothing'
      : 'the record doesn’t follow the head';
  }
  const failed = apply(state, record, roleOf(state, record.author));
  if (failed) {
    return failed;
  }
  state.head = record.id;
  state.seen.push(record.id);
  seen.add(record.id);
  return null;
}

// One record on top of the list as it stands.
export function applyRecord(
  state: AccessState,
  record: SignedAccessRecord,
): Validation {
  const next = clone(state);
  const failed = applyInto(next, record, new Set(state.seen));
  return failed ? refuse(failed) : { ok: true, state: next };
}

export function replayAccessList(
  vaultId: string,
  records: SignedAccessRecord[],
): Validation {
  const [root, ...rest] = records;
  if (!root) {
    return refuse('the list is empty');
  }
  const started = startAccessList(vaultId, root);
  if (!started.ok) {
    return started;
  }
  const { state } = started;
  const seen = new Set(state.seen);
  for (const record of rest) {
    const failed = applyInto(state, record, seen);
    if (failed) {
      return refuse(failed);
    }
  }
  return { ok: true, state };
}
