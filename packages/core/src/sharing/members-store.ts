import { sameHeads, type Cipher, type MergedOf } from '../meetings/index.ts';
import {
  createMembersDocument,
  loadMembersDocument,
  membersId,
  mergeMembersDocuments,
  nameMember,
  nameTeam,
  readMembersDocument,
  saveMembersDocument,
  type Members,
  type MembersDocument,
} from './members-document.ts';
import {
  createSingleDocumentStore,
  type SingleFile,
} from './single-document-store.ts';

export type MembersStore = {
  load: () => Promise<Members>;
  members: () => Members;
  nameTeam: (team: string) => Promise<Members>;
  nameMember: (identity: string, name: string) => Promise<Members>;
  ids: () => string[];
  document: (id: string) => MembersDocument | undefined;
  merge: (id: string, remote: MembersDocument) => MergedOf<Members>;
};

// A team's names, one file per team on this device, sealed with the same
// local key as its notes.
export function createMembersStore(options: {
  vaultId: string;
  file: SingleFile;
  cipher: Cipher;
}): MembersStore {
  const store = createSingleDocumentStore({
    file: options.file,
    cipher: options.cipher,
    kind: {
      name: 'member names',
      id: membersId,
      context: `nod:members:${options.vaultId}`,
      create: () => createMembersDocument(options.vaultId),
      read: readMembersDocument,
      empty: () => ({ team: '', names: {} }),
      merge: mergeMembersDocuments,
      same: sameHeads,
      save: saveMembersDocument,
      load: loadMembersDocument,
    },
  });
  return {
    load: store.load,
    members: store.state,
    nameTeam: (team) => store.change((current) => nameTeam(current, team)),
    nameMember: (identity, name) =>
      store.change((current) => nameMember(current, identity, name)),
    ids: store.ids,
    document: store.document,
    merge: store.merge,
  };
}
