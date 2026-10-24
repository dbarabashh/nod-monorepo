import { sha256 } from '@noble/hashes/sha2.js';
import {
  bytesOf,
  fromBase64Url,
  fromHex,
  isIdentityHex,
  sign,
  verify,
  type Identity,
  keyLength,
  open,
  parseIdentityCard,
  randomKey,
  seal,
  textOf,
  toBase64Url,
  toHex,
} from '../crypto/index.ts';
import { field } from '../meetings/field.ts';
import { relayBase } from '../sync/relay.ts';
import {
  isBase64Url,
  isGrantedRole,
  isKeyId,
  isRecordId,
  isShortHexId,
  isTeamVaultId,
  isWrap,
  type GrantedRole,
} from './access-list.ts';

export const inviteFileSchema = 1;
export const maxTeamNameLength = 120;
const fileIdLength = 16;
const linkPrefix = 'nod-join:v1:';
const context = 'nod:invite:v1';

// What the link's holder learns before asking to join, and the invite's
// private keys that prove they hold the link.
export type InviteFile = {
  team: string;
  inviter: string;
  vaultId: string;
  invite: string;
  signingKey: string;
  wrappingKey: string;
  role: GrantedRole;
  approval: boolean;
  // For an invite that needs no approval: the root key wrapped under the
  // invite's wrapping key, and the generation it belongs to, copied from
  // the invite record so the joiner needs nothing from a list they can't
  // read yet.
  key: { wrap: string; keyId: string } | null;
  host: string;
  // The inviter's identity signs what the file says, so a link can't name
  // someone it doesn't come from; the joiner then checks the list agrees.
  signature: string;
};

export type JoinLink = {
  vaultId: string;
  fileId: string;
  key: Uint8Array;
  host: string;
};

export function isTeamName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    value.length <= maxTeamNameLength
  );
}

// Nobody can guess the id: it hashes a file holding fresh random keys.
export function inviteFileIdOf(sealed: Uint8Array): string {
  return toHex(sha256(sealed).subarray(0, fileIdLength));
}

export function isInviteFileId(value: unknown): value is string {
  return isShortHexId(value);
}

function signedFields(file: Omit<InviteFile, 'signature'>): Uint8Array[] {
  return [
    bytesOf(file.vaultId),
    bytesOf(file.invite),
    bytesOf(file.team),
    bytesOf(file.role),
    bytesOf(file.approval ? 'approval' : 'instant'),
    bytesOf(file.host),
    bytesOf(file.signingKey),
    bytesOf(file.wrappingKey),
    bytesOf(file.key ? `${file.key.keyId}:${file.key.wrap}` : ''),
  ];
}

export function signInviteFile(
  inviter: Identity,
  file: Omit<InviteFile, 'signature'>,
): InviteFile {
  return {
    ...file,
    signature: toBase64Url(
      sign(inviter.signingKey, 'nod:sig:invite:v1', signedFields(file)),
    ),
  };
}

export function sealInviteFile(file: InviteFile): {
  sealed: Uint8Array;
  key: Uint8Array;
  fileId: string;
} {
  const key = randomKey();
  const sealed = seal(
    key,
    bytesOf(JSON.stringify({ schema: inviteFileSchema, ...file })),
    context,
  );
  return { sealed, key, fileId: inviteFileIdOf(sealed) };
}

// The file comes from a relay anyone can ask, so its shape is checked like
// any other untrusted data; the inviter's card must verify, since the joiner
// seals their name under its wrapping key.
export function openInviteFile(
  sealed: Uint8Array,
  key: Uint8Array,
): InviteFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(textOf(open(key, sealed, context)));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const team = field(raw, 'team');
  const inviter = field(raw, 'inviter');
  const vaultId = field(raw, 'vaultId');
  const invite = field(raw, 'invite');
  const signingKey = field(raw, 'signingKey');
  const wrappingKey = field(raw, 'wrappingKey');
  const role = field(raw, 'role');
  const approval = field(raw, 'approval');
  const wrapped = inviteKeyOf(field(raw, 'key'));
  const host = field(raw, 'host');
  const signature = field(raw, 'signature');
  const card = typeof inviter === 'string' ? parseIdentityCard(inviter) : null;
  if (
    field(raw, 'schema') !== inviteFileSchema ||
    !isTeamName(team) ||
    typeof inviter !== 'string' ||
    !card ||
    !isBase64Url(signature) ||
    !isTeamVaultId(vaultId) ||
    !isRecordId(invite) ||
    typeof signingKey !== 'string' ||
    !isIdentityHex(signingKey) ||
    typeof wrappingKey !== 'string' ||
    !isIdentityHex(wrappingKey) ||
    !isGrantedRole(role) ||
    typeof approval !== 'boolean' ||
    wrapped === undefined ||
    (wrapped === null) !== approval ||
    typeof host !== 'string' ||
    !hostOf(host)
  ) {
    return null;
  }
  const file = {
    team,
    inviter,
    vaultId,
    invite,
    signingKey,
    wrappingKey,
    role,
    approval,
    key: wrapped,
    host,
  };
  return verify(
    card.publicKey,
    fromBase64Url(signature),
    'nod:sig:invite:v1',
    signedFields(file),
  )
    ? { ...file, signature }
    : null;
}

// undefined for a shape that isn't a wrapped key, null for none.
function inviteKeyOf(
  raw: unknown,
): { wrap: string; keyId: string } | null | undefined {
  if (raw === null) {
    return null;
  }
  if (typeof raw !== 'object') {
    return undefined;
  }
  const wrap = field(raw, 'wrap');
  const keyId = field(raw, 'keyId');
  return isWrap(wrap) && isKeyId(keyId) ? { wrap, keyId } : undefined;
}

function hostOf(text: string): string | null {
  try {
    return relayBase(text).href;
  } catch {
    return null;
  }
}

// The host comes last, so a port in it can't be mistaken for a field.
export function joinLink(link: JoinLink): string {
  return `${linkPrefix}${link.vaultId}:${link.fileId}:${toBase64Url(link.key)}:${link.host}`;
}

export function parseJoinLink(text: string): JoinLink | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(linkPrefix)) {
    return null;
  }
  const parts = trimmed.slice(linkPrefix.length).split(':');
  const [vaultId = '', fileId = '', keyText = '', ...hostParts] = parts;
  const host = hostParts.length > 0 ? hostOf(hostParts.join(':')) : null;
  let key: Uint8Array;
  try {
    key = fromBase64Url(keyText);
  } catch {
    return null;
  }
  return isTeamVaultId(vaultId) &&
    isInviteFileId(fileId) &&
    key.length === keyLength &&
    host
    ? { vaultId, fileId, key, host }
    : null;
}

export function inviteKeysOf(file: InviteFile): {
  signingKey: Uint8Array;
  wrappingKey: Uint8Array;
} {
  return {
    signingKey: fromHex(file.signingKey),
    wrappingKey: fromHex(file.wrappingKey),
  };
}

const teamLinkPrefix = 'nod-team:v1:';

// Where a team already lists someone: its id and the relay it lives on.
// Holds no secret: a person
// the list doesn't name gets nothing from it.
export type TeamLink = { vaultId: string; host: string };

export function teamLink(link: TeamLink): string {
  return `${teamLinkPrefix}${link.vaultId}:${link.host}`;
}

export function parseTeamLink(text: string): TeamLink | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(teamLinkPrefix)) {
    return null;
  }
  const rest = trimmed.slice(teamLinkPrefix.length);
  const colon = rest.indexOf(':');
  const vaultId = colon < 0 ? rest : rest.slice(0, colon);
  const hostText = colon < 0 ? '' : rest.slice(colon + 1);
  if (!isTeamVaultId(vaultId)) {
    return null;
  }
  const host = hostOf(hostText);
  return host ? { vaultId, host } : null;
}
