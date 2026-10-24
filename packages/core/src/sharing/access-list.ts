import { sha256 } from '@noble/hashes/sha2.js';
import {
  bytesOf,
  fromBase64Url,
  fromHex,
  isIdentityHex,
  sign,
  textOf,
  toBase64Url,
  toHex,
  verify,
  type Identity,
} from '../crypto/index.ts';
import { field } from '../meetings/field.ts';
import { canonicalJson, type Json } from './canonical-json.ts';

export type Role = 'owner' | 'admin' | 'writer' | 'reader';

export const roles: Role[] = ['owner', 'admin', 'writer', 'reader'];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && roles.some((role) => role === value);
}

// A role another record may grant: ownership moves only by `ownerChange`.
export type GrantedRole = Exclude<Role, 'owner'>;

export function isGrantedRole(value: unknown): value is GrantedRole {
  return isRole(value) && value !== 'owner';
}

export const keyIdLength = 16;
const hexId = (bytes: number) => new RegExp(`^[0-9a-f]{${bytes * 2}}$`);
const recordIdPattern = hexId(32);
const keyIdPattern = hexId(keyIdLength);
const maxNameLength = 400;
const maxAccounts = 64;

// Only the one spelling each byte string has: base64url leaves unused bits
// in its last character, and a record whose signature could be spelled
// sixteen ways would have sixteen ids, so a relay could bring back a record
// already answered as a new one.
export function isBase64Url(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,4096}$/.test(value)) {
    return false;
  }
  try {
    return toBase64Url(fromBase64Url(value)) === value;
  } catch {
    return false;
  }
}

// A wrapped root key is an ephemeral X25519 key, the 32-byte key and a tag;
// a chain link is a version byte, a nonce, the old key and a tag. Exact
// sizes keep a record from carrying kilobytes in a field that holds bytes.
const wrapBytes = 32 + 32 + 16;
const chainBytes = 1 + 12 + 32 + 16;

function isBytesOf(value: unknown, length: number): value is string {
  return isBase64Url(value) && fromBase64Url(value).length === length;
}

export function isWrap(value: unknown): value is string {
  return isBytesOf(value, wrapBytes);
}

function isChain(value: unknown): value is string {
  return isBytesOf(value, chainBytes);
}

// A 16-byte id as hex: a key generation, a team vault or an invite file.
export function isShortHexId(value: unknown): value is string {
  return typeof value === 'string' && keyIdPattern.test(value);
}

export function isRecordId(value: unknown): value is string {
  return typeof value === 'string' && recordIdPattern.test(value);
}

export function isKeyId(value: unknown): value is string {
  return isShortHexId(value);
}

// A team vault's id is the first 16 bytes of its root record's hash.
export function isTeamVaultId(value: unknown): value is string {
  return isShortHexId(value);
}

// A new root key, wrapped under every remaining member's wrapping key, with
// the old key sealed under the new one so the chain back to the first
// generation stays readable.
export type KeyChange = {
  keyId: string;
  wraps: Record<string, string>;
  chain: string;
};

export type Account = { card: string; role: GrantedRole; wrap: string };

export type RecordBody =
  | { type: 'root'; card: string; keyId: string; wrap: string }
  | {
      type: 'invite';
      signingPublicKey: string;
      wrappingPublicKey: string;
      role: GrantedRole;
      approval: boolean;
      wrap: string | null;
    }
  | { type: 'inviteRevoke'; invite: string; keyChange: KeyChange | null }
  | {
      type: 'requestJoin';
      invite: string;
      card: string;
      proof: string;
      name: string | null;
    }
  | {
      type: 'inviteJoin';
      invite: string;
      card: string;
      proof: string;
      wrap: string;
      name: string | null;
    }
  | { type: 'requestAccept'; request: string; role: GrantedRole; wrap: string }
  | { type: 'requestDecline'; request: string }
  | { type: 'accountsAdd'; accounts: Account[] }
  | {
      type: 'permissionChanges';
      changes: Array<{ identity: string; role: GrantedRole }>;
      keyChange: KeyChange | null;
    }
  | { type: 'accountsRemove'; identities: string[]; keyChange: KeyChange }
  | { type: 'keyChange'; keyChange: KeyChange }
  | { type: 'requestRemove' }
  | { type: 'ownerChange'; owner: string; role: 'admin' | 'writer' };

export type RecordType = RecordBody['type'];

export const joinTypes: RecordType[] = ['requestJoin', 'inviteJoin'];

export function isJoinRecord(record: AccessRecord): boolean {
  return joinTypes.includes(record.body.type);
}

// One entry of a team's access list: who wrote it, what it follows, and
// what it does, signed by its author. Join records follow nothing, since a
// non-member can't know the head; the relay files them where they land.
export type AccessRecord = {
  author: string;
  prev: string | null;
  at: number;
  body: RecordBody;
  signature: string;
};

export type SignedAccessRecord = AccessRecord & { id: string };

export type RecordJson = {
  author: string;
  prev: string | null;
  at: number;
  body: Json;
  signature?: string;
};

function unsigned(record: Omit<AccessRecord, 'signature'>): RecordJson {
  return {
    author: record.author,
    prev: record.prev,
    at: record.at,
    body: bodyJson(record.body),
  };
}

function bodyJson(body: RecordBody): Json {
  return body;
}

export function recordJson(record: AccessRecord): RecordJson {
  return { ...unsigned(record), signature: record.signature };
}

// A record's id is the hash of the whole record with its signature, so two
// records that differ only in who signed them are two records.
export function recordIdOf(record: AccessRecord): string {
  return toHex(sha256(bytesOf(canonicalJson(recordJson(record)))));
}

export function signRecord(
  identity: Identity,
  prev: string | null,
  at: number,
  body: RecordBody,
): SignedAccessRecord {
  const author = toHex(identity.publicKey);
  const signature = toBase64Url(
    sign(identity.signingKey, 'nod:sig:acl:v1', [
      bytesOf(canonicalJson(unsigned({ author, prev, at, body }))),
    ]),
  );
  const record: AccessRecord = { author, prev, at, body, signature };
  return { ...record, id: recordIdOf(record) };
}

export function verifyRecord(record: AccessRecord): boolean {
  let signature: Uint8Array;
  try {
    signature = fromBase64Url(record.signature);
  } catch {
    return false;
  }
  return verify(fromHex(record.author), signature, 'nod:sig:acl:v1', [
    bytesOf(canonicalJson(unsigned(record))),
  ]);
}

function isPublicKeyHex(value: unknown): value is string {
  return typeof value === 'string' && isIdentityHex(value);
}

function isName(value: unknown): value is string | null {
  return (
    value === null || (isBase64Url(value) && value.length <= maxNameLength)
  );
}

function isCard(value: unknown): value is string {
  return typeof value === 'string' && value.length <= maxNameLength;
}

function parseKeyChange(raw: unknown): KeyChange | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const keyId = field(raw, 'keyId');
  const chain = field(raw, 'chain');
  const rawWraps = field(raw, 'wraps');
  if (
    !isKeyId(keyId) ||
    !isChain(chain) ||
    typeof rawWraps !== 'object' ||
    rawWraps === null
  ) {
    return null;
  }
  const wraps: Record<string, string> = {};
  for (const [recipient, wrap] of Object.entries(rawWraps)) {
    if (!isPublicKeyHex(recipient) || !isWrap(wrap)) {
      return null;
    }
    wraps[recipient] = wrap;
  }
  return { keyId, wraps, chain };
}

function optionalKeyChange(raw: unknown): KeyChange | null | undefined {
  if (raw === null) {
    return null;
  }
  return parseKeyChange(raw) ?? undefined;
}

function parseBody(raw: unknown): RecordBody | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const type = field(raw, 'type');
  const get = (key: string) => field(raw, key);
  switch (type) {
    case 'root': {
      const card = get('card');
      const keyId = get('keyId');
      const wrap = get('wrap');
      return isCard(card) && isKeyId(keyId) && isWrap(wrap)
        ? { type, card, keyId, wrap }
        : null;
    }
    case 'invite': {
      const signingPublicKey = get('signingPublicKey');
      const wrappingPublicKey = get('wrappingPublicKey');
      const role = get('role');
      const approval = get('approval');
      const wrap = get('wrap');
      return isPublicKeyHex(signingPublicKey) &&
        isPublicKeyHex(wrappingPublicKey) &&
        isGrantedRole(role) &&
        typeof approval === 'boolean' &&
        (wrap === null || isWrap(wrap))
        ? { type, signingPublicKey, wrappingPublicKey, role, approval, wrap }
        : null;
    }
    case 'inviteRevoke': {
      const invite = get('invite');
      const keyChange = optionalKeyChange(get('keyChange'));
      return isRecordId(invite) && keyChange !== undefined
        ? { type, invite, keyChange }
        : null;
    }
    case 'requestJoin': {
      const invite = get('invite');
      const card = get('card');
      const proof = get('proof');
      const name = get('name');
      return isRecordId(invite) &&
        isCard(card) &&
        isBase64Url(proof) &&
        isName(name)
        ? { type, invite, card, proof, name }
        : null;
    }
    case 'inviteJoin': {
      const invite = get('invite');
      const card = get('card');
      const proof = get('proof');
      const wrap = get('wrap');
      const name = get('name');
      return isRecordId(invite) &&
        isCard(card) &&
        isBase64Url(proof) &&
        isWrap(wrap) &&
        isName(name)
        ? { type, invite, card, proof, wrap, name }
        : null;
    }
    case 'requestAccept': {
      const request = get('request');
      const role = get('role');
      const wrap = get('wrap');
      return isRecordId(request) && isGrantedRole(role) && isWrap(wrap)
        ? { type, request, role, wrap }
        : null;
    }
    case 'requestDecline': {
      const request = get('request');
      return isRecordId(request) ? { type, request } : null;
    }
    case 'accountsAdd': {
      const rawAccounts = get('accounts');
      if (
        !Array.isArray(rawAccounts) ||
        rawAccounts.length === 0 ||
        rawAccounts.length > maxAccounts
      ) {
        return null;
      }
      const accounts: Account[] = [];
      for (const item of rawAccounts) {
        if (typeof item !== 'object' || item === null) {
          return null;
        }
        const card = field(item, 'card');
        const role = field(item, 'role');
        const wrap = field(item, 'wrap');
        if (!isCard(card) || !isGrantedRole(role) || !isWrap(wrap)) {
          return null;
        }
        accounts.push({ card, role, wrap });
      }
      return { type, accounts };
    }
    case 'permissionChanges': {
      const rawChanges = get('changes');
      const keyChange = optionalKeyChange(get('keyChange'));
      if (
        !Array.isArray(rawChanges) ||
        rawChanges.length === 0 ||
        rawChanges.length > maxAccounts ||
        keyChange === undefined
      ) {
        return null;
      }
      const changes: Array<{ identity: string; role: GrantedRole }> = [];
      for (const item of rawChanges) {
        if (typeof item !== 'object' || item === null) {
          return null;
        }
        const identity = field(item, 'identity');
        const role = field(item, 'role');
        if (
          typeof identity !== 'string' ||
          !isIdentityHex(identity) ||
          !isGrantedRole(role)
        ) {
          return null;
        }
        changes.push({ identity, role });
      }
      return { type, changes, keyChange };
    }
    case 'accountsRemove': {
      const identities = get('identities');
      const keyChange = parseKeyChange(get('keyChange'));
      return Array.isArray(identities) &&
        identities.length > 0 &&
        identities.length <= maxAccounts &&
        identities.every(
          (identity) => typeof identity === 'string' && isIdentityHex(identity),
        ) &&
        keyChange
        ? {
            type,
            identities: identities.filter(
              (identity): identity is string => typeof identity === 'string',
            ),
            keyChange,
          }
        : null;
    }
    case 'keyChange': {
      const keyChange = parseKeyChange(get('keyChange'));
      return keyChange ? { type, keyChange } : null;
    }
    case 'requestRemove':
      return { type };
    case 'ownerChange': {
      const owner = get('owner');
      const role = get('role');
      // The old owner keeps a writing role: taking write away is a role
      // change of its own, which rotates the key.
      return typeof owner === 'string' &&
        isIdentityHex(owner) &&
        (role === 'admin' || role === 'writer')
        ? { type, owner, role }
        : null;
    }
    default:
      return null;
  }
}

// Records arrive from a relay, so their shape is checked like
// any other untrusted data before the signature is. Only the shape: whether
// the author may do this is the validator's question.
export function parseAccessRecord(raw: unknown): SignedAccessRecord | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const author = field(raw, 'author');
  const prev = field(raw, 'prev');
  const at = field(raw, 'at');
  const signature = field(raw, 'signature');
  const body = parseBody(field(raw, 'body'));
  if (
    typeof author !== 'string' ||
    !isIdentityHex(author) ||
    !(prev === null || isRecordId(prev)) ||
    typeof at !== 'number' ||
    !Number.isSafeInteger(at) ||
    at < 0 ||
    !isBase64Url(signature) ||
    !body
  ) {
    return null;
  }
  const record: AccessRecord = { author, prev, at, body, signature };
  return verifyRecord(record) ? { ...record, id: recordIdOf(record) } : null;
}

export function parseAccessRecords(raw: unknown): SignedAccessRecord[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const records: SignedAccessRecord[] = [];
  for (const item of raw) {
    const record = parseAccessRecord(item);
    if (!record) {
      return null;
    }
    records.push(record);
  }
  return records;
}

// The vault is named after its first record, so rotating the key never
// moves it, and only the owner who signed the root could have made that id.
export function teamVaultIdOf(root: AccessRecord): string {
  return recordIdOf(root).slice(0, keyIdLength * 2);
}

// The list as it travels and is stored: a JSON array of records.
export function encodeAccessList(records: AccessRecord[]): Uint8Array {
  return bytesOf(JSON.stringify(records.map(recordJson)));
}

export function decodeAccessList(
  bytes: Uint8Array,
): SignedAccessRecord[] | null {
  try {
    return parseAccessRecords(JSON.parse(textOf(bytes)));
  } catch {
    return null;
  }
}

// Whether a list is the known one with more records on top.
export function extendsKnown(
  known: SignedAccessRecord[],
  records: SignedAccessRecord[],
): boolean {
  return (
    records.length >= known.length &&
    known.every((record, index) => records[index]?.id === record.id)
  );
}
