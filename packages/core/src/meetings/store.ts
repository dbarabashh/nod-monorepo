import {
  createDocument,
  importedDocument,
  loadDocumentState,
  mergeDocuments,
  readDocument,
  sameDocument,
  saveDocument,
  tombstone,
  updateDocument,
  type DocumentState,
  type MeetingDocument,
} from './document.ts';
import {
  createDocumentStore,
  type Cipher,
  type DocumentFiles,
  type DocumentKind,
  type MergedOf,
} from './document-store.ts';
import type { Meeting } from './meeting.ts';

// open: meetings are stored, so their key must be there. create: nothing is
// stored yet. replace: a new key in a new place, never over the old one.
export type CipherMode = 'open' | 'create' | 'replace';

// Meetings are on disk but the key that seals them isn't, or can't be read,
// as after a backup was restored to another device: keychains keep their
// keys to one device. It may also be a passing failure, so nothing is
// replaced until the user chooses to start over.
export class KeyLostError extends Error {}

export type MeetingFiles = DocumentFiles;

export type Merged<S = DocumentState> = MergedOf<S>;

export type MeetingStore = {
  load: () => Promise<Meeting[]>;
  startOver: () => Promise<void>;
  save: (meeting: Meeting) => Promise<void>;
  importMeeting: (meeting: Meeting) => Promise<void>;
  remove: (id: string, deletedAt: number) => Promise<void>;
  flush: () => Promise<void>;
  meetings: () => Meeting[];
  meeting: (id: string) => Meeting | undefined;
  ids: () => string[];
  document: (id: string) => MeetingDocument | undefined;
  merge: (id: string, remote: MeetingDocument) => Merged;
  isDeleted: (id: string) => boolean;
};

const idPattern = /^[A-Za-z0-9_-]{1,64}$/;

export function isMeetingId(id: string): boolean {
  return idPattern.test(id);
}

const meetingKind: DocumentKind<MeetingDocument, DocumentState, Meeting> = {
  name: 'meeting',
  isId: isMeetingId,
  context: (id) => `nod:meeting:${id}`,
  create: createDocument,
  update: updateDocument,
  tombstone,
  read: readDocument,
  valueOf: (state) => (state.kind === 'meeting' ? state.meeting : null),
  merge: mergeDocuments,
  same: sameDocument,
  save: saveDocument,
  load: loadDocumentState,
};

export function createMeetingStore(options: {
  files: MeetingFiles;
  cipher: (mode: CipherMode) => Promise<Cipher>;
  onWrite?: (id: string) => void;
}): MeetingStore {
  const { files } = options;
  const store = createDocumentStore({
    files,
    kind: meetingKind,
    onWrite: options.onWrite,
  });
  return {
    load: () =>
      store.load((stored) =>
        options.cipher(stored.length > 0 ? 'open' : 'create'),
      ),
    // The meetings that can't be opened are kept beside a new key, and come
    // back from the user's other devices once this one syncs again.
    // The new key comes first, so a failure to make one leaves every file
    // where it was.
    startOver: async () => {
      const next = await options.cipher('replace');
      for (const id of (await files.ids()).filter(isMeetingId)) {
        await files.setAside(id);
      }
      store.reset(next);
    },
    save: store.save,
    importMeeting: (meeting) => store.importValue(meeting, importedDocument),
    remove: store.remove,
    flush: store.flush,
    meetings: store.values,
    meeting: store.value,
    ids: store.ids,
    document: store.document,
    merge: store.merge,
    isDeleted: store.isDeleted,
  };
}
