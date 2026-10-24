import { sameHeads, type Cipher, type MergedOf } from '../meetings/index.ts';
import {
  addPeer,
  addTeam,
  createSharesDocument,
  leaveTeam,
  loadSharesDocument,
  mergeSharesDocuments,
  readSharesDocument,
  saveSharesDocument,
  sharesId,
  stopPeer,
  type Shares,
  type TeamEntry,
  type SharesDocument,
} from './shares-document.ts';
import {
  createSingleDocumentStore,
  type SingleDocumentKind,
  type SingleFile,
} from './single-document-store.ts';

// The one file that holds whom this person shares with, sealed with the same
// local key as meetings; each app keeps it over its own filesystem.
export type SharesFile = SingleFile;

export type SharesStore = {
  load: () => Promise<Shares>;
  shares: () => Shares;
  addPeer: (card: string) => Promise<Shares>;
  stopPeer: (identity: string, at: number) => Promise<Shares>;
  addTeam: (vaultId: string, entry: TeamEntry) => Promise<Shares>;
  leaveTeam: (vaultId: string, at: number) => Promise<Shares>;
  ids: () => string[];
  document: (id: string) => SharesDocument | undefined;
  merge: (id: string, remote: SharesDocument) => MergedOf<Shares>;
};

const sharesKind: SingleDocumentKind<SharesDocument, Shares> = {
  name: 'shares',
  id: sharesId,
  context: 'nod:shares',
  create: createSharesDocument,
  read: readSharesDocument,
  empty: () => ({ peers: [], teams: [] }),
  merge: mergeSharesDocuments,
  same: sameHeads,
  save: saveSharesDocument,
  load: loadSharesDocument,
};

export function createSharesStore(options: {
  file: SharesFile;
  cipher: Cipher;
}): SharesStore {
  const store = createSingleDocumentStore({ ...options, kind: sharesKind });
  return {
    load: store.load,
    shares: store.state,
    addPeer: (card) => store.change((current) => addPeer(current, card)),
    stopPeer: (identity, at) =>
      store.change((current) => stopPeer(current, identity, at)),
    addTeam: (vaultId, entry) =>
      store.change((current) => addTeam(current, vaultId, entry)),
    leaveTeam: (vaultId, at) =>
      store.change((current) => leaveTeam(current, vaultId, at)),
    ids: store.ids,
    document: store.document,
    merge: store.merge,
  };
}
