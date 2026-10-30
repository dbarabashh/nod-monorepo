import {
  createDocumentStore,
  type Cipher,
  type DocumentKind,
  type MeetingFiles,
  type MergedOf,
} from '../meetings/index.ts';
import {
  createNoteDocument,
  loadNoteDocument,
  mergeNoteDocuments,
  noteTombstone,
  readNoteDocument,
  sameNoteDocument,
  saveNoteDocument,
  noteHeads,
  updateNoteDocument,
  updateNoteDocumentFrom,
  type NoteDocument,
  type NoteState,
} from './note-document.ts';
import { isNoteId, type SharedNote } from './note.ts';

export type NoteFiles = MeetingFiles;

export type NoteStore = {
  load: () => Promise<SharedNote[]>;
  save: (note: SharedNote) => Promise<void>;
  saveFrom: (
    id: string,
    version: string,
    edit: (seen: SharedNote) => SharedNote,
  ) => Promise<string>;
  version: (id: string) => string | null;
  remove: (id: string, deletedAt: number) => Promise<void>;
  flush: () => Promise<void>;
  notes: () => SharedNote[];
  note: (id: string) => SharedNote | undefined;
  ids: () => string[];
  document: (id: string) => NoteDocument | undefined;
  merge: (id: string, remote: NoteDocument) => MergedOf<NoteState>;
  isDeleted: (id: string) => boolean;
};

const noteKind: DocumentKind<NoteDocument, NoteState, SharedNote> = {
  name: 'note',
  isId: isNoteId,
  context: (id) => `nod:note:${id}`,
  create: createNoteDocument,
  update: updateNoteDocument,
  updateFrom: updateNoteDocumentFrom,
  version: noteHeads,
  tombstone: noteTombstone,
  read: readNoteDocument,
  valueOf: (state) => (state.kind === 'note' ? state.note : null),
  merge: mergeNoteDocuments,
  same: sameNoteDocument,
  save: saveNoteDocument,
  load: loadNoteDocument,
};

// Notes of one shared vault, kept the way meetings are and sealed with the
// same local key.
export function createNoteStore(options: {
  files: NoteFiles;
  cipher: Cipher;
  onWrite?: (id: string) => void;
}): NoteStore {
  const store = createDocumentStore({
    files: options.files,
    kind: noteKind,
    onWrite: options.onWrite,
  });
  return {
    load: () => store.load(async () => options.cipher),
    save: store.save,
    saveFrom: store.saveFrom,
    version: store.version,
    remove: store.remove,
    flush: store.flush,
    notes: store.values,
    note: store.value,
    ids: store.ids,
    document: store.document,
    merge: store.merge,
    isDeleted: store.isDeleted,
  };
}
