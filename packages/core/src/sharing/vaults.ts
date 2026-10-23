import { equalBytes } from '@noble/ciphers/utils.js';
import {
  fileKeyOf,
  identityHex,
  keyIdLength,
  oneToOneRootKey,
  open,
  openSigned,
  relayToken,
  seal,
  sealSigned,
  vaultIdOf,
  type Identity,
  type IdentityCard,
} from '../crypto/index.ts';
import type { SyncDocuments } from '../sync/engine.ts';
import {
  noteContext,
  notePath,
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

// Notes in a shared vault: version 2 files, signed by their publisher. A file
// from anyone who may not write here, or under another key generation than
// the vault's current one, is left unread, however well it is sealed.
export function sharedNoteDocuments(vault: {
  id: string;
  fileKey: Uint8Array;
  keyId: Uint8Array;
  identity: Identity;
  publishers: Uint8Array[];
}): SyncDocuments<NoteDocument, NoteState> {
  const allowed = new Set(vault.publishers.map(identityHex));
  return {
    name: 'note',
    path: notePath,
    parse: (path) => {
      const parsed = parseNotePath(path);
      return parsed ? { deviceId: parsed.deviceId, id: parsed.noteId } : null;
    },
    seal: (plain, deviceId, id) =>
      sealSigned(
        vault.fileKey,
        vault.keyId,
        vault.identity,
        plain,
        noteContext(vault.id, deviceId, id),
      ),
    open: (sealed, deviceId, id) => {
      try {
        const opened = openSigned(
          vault.fileKey,
          sealed,
          noteContext(vault.id, deviceId, id),
        );
        return allowed.has(identityHex(opened.identity)) &&
          equalBytes(opened.keyId, vault.keyId)
          ? opened.plain
          : null;
      } catch {
        return null;
      }
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
  };
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
