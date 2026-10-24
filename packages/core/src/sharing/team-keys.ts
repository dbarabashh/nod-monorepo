import { equalBytes, randomBytes } from '@noble/ciphers/utils.js';
import {
  bytesOf,
  fromBase64Url,
  fromHex,
  keyLength,
  open,
  openFor,
  randomKey,
  seal,
  sealFor,
  sign,
  textOf,
  toBase64Url,
  toHex,
  type Identity,
} from '../crypto/index.ts';
import { keyIdLength, type KeyChange, type RecordType } from './access-list.ts';
import type { AccessState, Generation } from './access-list-validator.ts';

// A generation is named by random bytes the record carries, not by the
// record's hash: the wraps and the chain inside the record bind that name,
// and a hash of the record would have to include them.
export function newKeyId(): string {
  return toHex(randomBytes(keyIdLength));
}

export function newRootKey(): Uint8Array {
  return randomKey();
}

// The vault id is part of every wrap but the root's, which is written before
// the vault has an id (the id is the root's hash); a root wrap is bound by
// its key id, random and introduced once.
function wrapContext(
  vaultId: string,
  type: RecordType,
  keyId: string,
  recipientWrappingPublicKey: string,
): string {
  return `nod:wrap:${vaultId}:${type}:${keyId}:${recipientWrappingPublicKey}`;
}

// The root key of one generation, for one recipient, in one record of one
// vault: the context names all four, so a wrap can't be replayed anywhere
// else.
export function wrapRootKey(
  recipientWrappingPublicKey: string,
  rootKey: Uint8Array,
  type: RecordType,
  keyId: string,
  vaultId: string,
): string {
  return toBase64Url(
    sealFor(
      fromHex(recipientWrappingPublicKey),
      rootKey,
      wrapContext(vaultId, type, keyId, recipientWrappingPublicKey),
    ),
  );
}

export function unwrapRootKey(
  wrappingKey: Uint8Array,
  wrappingPublicKey: string,
  wrapped: string,
  type: RecordType,
  keyId: string,
  vaultId: string,
): Uint8Array | null {
  try {
    const key = openFor(
      wrappingKey,
      fromBase64Url(wrapped),
      wrapContext(vaultId, type, keyId, wrappingPublicKey),
    );
    return key.length === keyLength ? key : null;
  } catch {
    return null;
  }
}

function chainContext(
  vaultId: string,
  oldKeyId: string,
  newKeyId: string,
): string {
  return `nod:keychain:${vaultId}:${oldKeyId}:${newKeyId}`;
}

// A new key for everyone who stays, with the old key sealed under it, so a
// member who holds the newest key opens every generation back to the
// first. Invites get none: an approval invite's keys sit in a file anyone
// with the link can open, and the accept record wraps the key for the
// person it lets in.
export function keyChangeFor(
  state: AccessState,
  type: RecordType,
  from: { keyId: string; rootKey: Uint8Array },
  keep: (identity: string) => boolean = () => true,
): { change: KeyChange; rootKey: Uint8Array } {
  const keyId = newKeyId();
  const rootKey = newRootKey();
  const wraps: Record<string, string> = {};
  for (const member of Object.values(state.members)) {
    if (keep(member.identity)) {
      wraps[member.wrappingPublicKey] = wrapRootKey(
        member.wrappingPublicKey,
        rootKey,
        type,
        keyId,
        state.vaultId,
      );
    }
  }
  return {
    change: {
      keyId,
      wraps,
      chain: toBase64Url(
        seal(
          rootKey,
          from.rootKey,
          chainContext(state.vaultId, from.keyId, keyId),
        ),
      ),
    },
    rootKey,
  };
}

export type TeamKeys = {
  // The root key of every generation this identity can open, newest last.
  rootKeys: Map<string, Uint8Array>;
  current: { keyId: string; rootKey: Uint8Array } | null;
  // Generations this identity can't open, newest first, with who wrote the
  // record that introduced each.
  missing: Array<{ keyId: string; record: string }>;
};

function unwrapFor(
  vaultId: string,
  identity: Identity,
  generation: Generation,
): Uint8Array | null {
  const mine = toHex(identity.wrappingPublicKey);
  const wrap = generation.wraps[mine];
  return wrap
    ? unwrapRootKey(
        identity.wrappingKey,
        mine,
        wrap.wrapped,
        wrap.type,
        generation.keyId,
        wrap.type === 'root' ? '' : vaultId,
      )
    : null;
}

function openChain(
  vaultId: string,
  generation: Generation,
  previous: Generation,
  rootKey: Uint8Array,
): Uint8Array | null {
  if (generation.chain === null) {
    return null;
  }
  try {
    const key = open(
      rootKey,
      fromBase64Url(generation.chain),
      chainContext(vaultId, previous.keyId, generation.keyId),
    );
    return key.length === keyLength ? key : null;
  } catch {
    return null;
  }
}

// What this identity can read: from the newest generation wrapped for it,
// back along the chain to the first. A wrap that doesn't open, or a chain
// that doesn't, leaves a gap the app shows rather than hides. A wrap that
// opens to a key whose chain doesn't lead back to the generation before is
// a gap too: an admin who wrapped a key of their own for one member would
// otherwise cut that member off from the team unnoticed.
export function recoverTeamKeys(
  state: AccessState,
  identity: Identity,
): TeamKeys {
  const rootKeys = new Map<string, Uint8Array>();
  const missing: TeamKeys['missing'] = [];
  const { generations, vaultId } = state;
  let known: Uint8Array | null = null;
  for (let index = generations.length - 1; index >= 0; index -= 1) {
    const generation = generations[index];
    const next = generations[index + 1];
    if (!generation) {
      continue;
    }
    const unwrapped = unwrapFor(vaultId, identity, generation);
    const chained: Uint8Array | null =
      next && known ? openChain(vaultId, next, generation, known) : null;
    const rootKey: Uint8Array | null = chained ?? unwrapped;
    if (rootKey) {
      rootKeys.set(generation.keyId, rootKey);
    } else {
      missing.push({ keyId: generation.keyId, record: generation.record });
    }
    known = rootKey;
  }
  // Each generation's key must open the chain to the one before it.
  for (let index = generations.length - 1; index >= 1; index -= 1) {
    const generation = generations[index];
    const previous = generations[index - 1];
    const key = generation ? rootKeys.get(generation.keyId) : undefined;
    const before = previous ? rootKeys.get(previous.keyId) : undefined;
    if (!generation || !previous || !key || !before) {
      continue;
    }
    const opened = openChain(vaultId, generation, previous, key);
    if (!opened || !equalBytes(opened, before)) {
      rootKeys.delete(generation.keyId);
      missing.unshift({ keyId: generation.keyId, record: generation.record });
    }
  }
  missing.sort(
    (a, b) =>
      generations.findIndex((generation) => generation.keyId === b.keyId) -
      generations.findIndex((generation) => generation.keyId === a.keyId),
  );
  const newest = generations.at(-1);
  const newestKey = newest ? rootKeys.get(newest.keyId) : undefined;
  return {
    rootKeys,
    current:
      newest && newestKey ? { keyId: newest.keyId, rootKey: newestKey } : null,
    missing,
  };
}

// Proof that whoever asks to join holds the invite's link: the invite's own
// key signs the joiner's identity and the invite's id.
export function joinProof(
  inviteSigningKey: Uint8Array,
  identity: Identity,
  inviteId: string,
): string {
  return toBase64Url(
    sign(inviteSigningKey, 'nod:sig:join:v1', [
      identity.publicKey,
      bytesOf(inviteId),
    ]),
  );
}

const nameContext = 'nod:join-name:v1';

// The name a joiner chose, readable by the inviter alone; the relay and the
// other members see only its wrap.
export function sealJoinName(
  inviterWrappingPublicKey: Uint8Array,
  name: string,
): string {
  return toBase64Url(
    sealFor(inviterWrappingPublicKey, bytesOf(name), nameContext),
  );
}

export function openJoinName(
  identity: Identity,
  sealed: string,
): string | null {
  try {
    return textOf(
      openFor(identity.wrappingKey, fromBase64Url(sealed), nameContext),
    );
  } catch {
    return null;
  }
}
