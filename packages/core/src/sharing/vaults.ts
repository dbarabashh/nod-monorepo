import {
  fileKeyOf,
  fromHex,
  identityHex,
  keyIdLength,
  oneToOneRootKey,
  open,
  openSigned,
  readSignedFileHeader,
  relayToken,
  seal,
  sealSigned,
  toHex,
  vaultIdOf,
  type Identity,
  type IdentityCard,
} from '../crypto/index.ts';
import {
  canManage,
  canWrite,
  mayHaveManaged,
  mayHaveWritten,
  roleOf,
  type AccessState,
} from './access-list-validator.ts';
import {
  loadMembersDocument,
  membersHeads,
  membersId,
  saveMembersDocument,
  type Members,
  type MembersDocument,
} from './members-document.ts';
import type { TeamKeys } from './team-keys.ts';
import type { SyncDocuments } from '../sync/engine.ts';
import {
  membersContext,
  membersPath,
  noteContext,
  notePath,
  parseMembersPath,
  parseNotePath,
  parseSharesPath,
  sharesContext,
  sharesPath,
} from '../sync/layout.ts';
import {
  loadNoteDocument,
  noteHeads,
  saveNoteDocument,
  type NoteDocument,
  type NoteState,
} from './note-document.ts';
import {
  loadSharesDocument,
  saveSharesDocument,
  sharesHeads,
  sharesId,
  type Shares,
  type SharesDocument,
} from './shares-document.ts';

// A vault two people derive from each other's cards: an ordinary vault to
// the relay and the folder, with one key generation and the two of them as
// its only publishers.
export type OneToOneVault = {
  id: string;
  rootKey: Uint8Array;
  fileKey: Uint8Array;
  token: string;
  publishers: Uint8Array[];
};

// One generation, never rotated: all zeros, fresh each time so no caller
// can change the shared value.
export const oneToOneKeyId = (): Uint8Array => new Uint8Array(keyIdLength);

export function oneToOneVault(
  identity: Identity,
  peer: IdentityCard,
): OneToOneVault {
  const rootKey = oneToOneRootKey(identity, peer);
  return {
    id: vaultIdOf(rootKey),
    rootKey,
    fileKey: fileKeyOf(rootKey),
    token: relayToken(rootKey),
    publishers: [identity.publicKey, peer.publicKey],
  };
}

// What a device needs to read and write one shared vault's files: the key
// of each generation it can open, the current one to seal under, and who
// may have written under which generation.
export type SharedVaultKeys = {
  id: string;
  identity: Identity;
  current: () => { keyId: string; fileKey: Uint8Array } | null;
  fileKeyFor: (keyId: string) => Uint8Array | null;
  // Whether a file under that generation, by that publisher, is opened at
  // all: they could write (or manage) while it was current.
  mayWrite: (identity: string, keyId: string) => boolean;
  mayManage: (identity: string, keyId: string) => boolean;
  // Whether they still can: a copy from someone who lost the right is never
  // taken, so a removed writer who kept an old key can't edit or delete
  // anything after the fact. What they wrote before reaches everyone in the
  // copies of those who still write.
  writesNow: (identity: string) => boolean;
  managesNow: (identity: string) => boolean;
};

export function oneToOneKeys(
  identity: Identity,
  vault: OneToOneVault,
): SharedVaultKeys {
  const allowed = new Set(vault.publishers.map(identityHex));
  const keyId = toHex(oneToOneKeyId());
  return {
    id: vault.id,
    identity,
    current: () => ({ keyId, fileKey: vault.fileKey }),
    fileKeyFor: (id) => (id === keyId ? vault.fileKey : null),
    mayWrite: (publisher, id) => id === keyId && allowed.has(publisher),
    mayManage: (publisher, id) => id === keyId && allowed.has(publisher),
    writesNow: (publisher) => allowed.has(publisher),
    managesNow: (publisher) => allowed.has(publisher),
  };
}

export type TeamView = { state: AccessState; keys: TeamKeys };

// A team vault: one file key per generation, derived from that generation's
// root key the way a personal vault derives its own. The view is read on
// every call, so a list that grew or a key that rotated takes effect at
// once without a new engine.
export function teamKeys(
  vaultId: string,
  identity: Identity,
  view: () => TeamView | null,
): SharedVaultKeys {
  const fileKeys = new Map<string, Uint8Array>();
  const fileKeyFor = (keyId: string): Uint8Array | null => {
    const known = fileKeys.get(keyId);
    if (known) {
      return known;
    }
    const rootKey = view()?.keys.rootKeys.get(keyId);
    if (!rootKey) {
      return null;
    }
    const fileKey = fileKeyOf(rootKey);
    fileKeys.set(keyId, fileKey);
    return fileKey;
  };
  return {
    id: vaultId,
    identity,
    current: () => {
      const current = view()?.keys.current;
      const fileKey = current ? fileKeyFor(current.keyId) : null;
      return current && fileKey ? { keyId: current.keyId, fileKey } : null;
    },
    fileKeyFor,
    mayWrite: (publisher, keyId) => {
      const state = view()?.state;
      return state ? mayHaveWritten(state, publisher, keyId) : false;
    },
    mayManage: (publisher, keyId) => {
      const state = view()?.state;
      return state ? mayHaveManaged(state, publisher, keyId) : false;
    },
    writesNow: (publisher) => {
      const state = view()?.state;
      return state ? canWrite(roleOf(state, publisher)) : false;
    },
    managesNow: (publisher) => {
      const state = view()?.state;
      return state ? canManage(roleOf(state, publisher)) : false;
    },
  };
}

function publisherOf(sealed: Uint8Array): string | null {
  try {
    return identityHex(readSignedFileHeader(sealed).identity);
  } catch {
    return null;
  }
}

function signedDocuments<D, S>(
  vault: SharedVaultKeys,
  rights: {
    allowed: (publisher: string, keyId: string) => boolean;
    now: (publisher: string) => boolean;
  },
  context: (deviceId: string, id: string) => string,
  kind: Pick<
    SyncDocuments<D, S>,
    'name' | 'path' | 'parse' | 'load' | 'heads' | 'save'
  >,
): SyncDocuments<D, S> {
  const { allowed, now } = rights;
  return {
    ...kind,
    admit: (sealed) => {
      const publisher = publisherOf(sealed);
      return publisher !== null && now(publisher);
    },
    seal: (plain, deviceId, id) => {
      const current = vault.current();
      if (!current) {
        throw new Error('This device has no current key for the shared vault');
      }
      return sealSigned(
        current.fileKey,
        fromHex(current.keyId),
        vault.identity,
        plain,
        context(deviceId, id),
      );
    },
    // A file from anyone who may not write here, or under a generation this
    // device can't open, is left unread, however well it is sealed.
    open: (sealed, deviceId, id) => {
      try {
        const header = readSignedFileHeader(sealed);
        const keyId = toHex(header.keyId);
        const fileKey = vault.fileKeyFor(keyId);
        if (!fileKey || !allowed(identityHex(header.identity), keyId)) {
          return null;
        }
        return openSigned(fileKey, sealed, context(deviceId, id)).plain;
      } catch {
        return null;
      }
    },
  };
}

// Notes in a shared vault: version 2 files, signed by their publisher.
export function sharedNoteDocuments(
  vault: SharedVaultKeys,
): SyncDocuments<NoteDocument, NoteState> {
  return signedDocuments(
    vault,
    { allowed: vault.mayWrite, now: vault.writesNow },
    (deviceId, id) => noteContext(vault.id, deviceId, id),
    {
      name: 'note',
      path: notePath,
      parse: (path) => {
        const parsed = parseNotePath(path);
        return parsed ? { deviceId: parsed.deviceId, id: parsed.noteId } : null;
      },
      load: (plain) => {
        const loaded = loadNoteDocument(plain);
        return loaded
          ? {
              document: loaded.document,
              id: loaded.state.id,
              state: loaded.state,
            }
          : null;
      },
      heads: noteHeads,
      save: saveNoteDocument,
    },
  );
}

// A team's member names, written by its owners and admins.
export function membersDocuments(
  vault: SharedVaultKeys,
): SyncDocuments<MembersDocument, Members> {
  return signedDocuments(
    vault,
    { allowed: vault.mayManage, now: vault.managesNow },
    (deviceId) => membersContext(vault.id, deviceId),
    {
      name: 'member list',
      path: (deviceId) => membersPath(deviceId),
      parse: (path) => {
        const deviceId = parseMembersPath(path);
        return deviceId ? { deviceId, id: membersId } : null;
      },
      load: (plain) => {
        const loaded = loadMembersDocument(plain);
        return loaded
          ? { document: loaded.document, id: membersId, state: loaded.state }
          : null;
      },
      heads: membersHeads,
      save: saveMembersDocument,
    },
  );
}

// The shares document in a person's own vault: one version 1 file per device,
// beside their meetings, under the same file key.
export function sharesDocuments(vault: {
  id: string;
  key: Uint8Array;
}): SyncDocuments<SharesDocument, Shares> {
  const fileKey = fileKeyOf(vault.key);
  return {
    name: 'shares list',
    path: (deviceId) => sharesPath(deviceId),
    parse: (path) => {
      const deviceId = parseSharesPath(path);
      return deviceId ? { deviceId, id: sharesId } : null;
    },
    seal: (plain, deviceId) =>
      seal(fileKey, plain, sharesContext(vault.id, deviceId)),
    open: (sealed, deviceId) => {
      try {
        return open(fileKey, sealed, sharesContext(vault.id, deviceId));
      } catch {
        return null;
      }
    },
    load: (plain) => {
      const loaded = loadSharesDocument(plain);
      return loaded
        ? { document: loaded.document, id: sharesId, state: loaded.state }
        : null;
    },
    heads: sharesHeads,
    save: saveSharesDocument,
  };
}
