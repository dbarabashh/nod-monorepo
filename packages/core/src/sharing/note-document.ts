import * as Automerge from '@automerge/automerge';
import {
  field,
  fixedActor,
  headsOf,
  mergeChanges,
  plainValue,
  sameHeads,
} from '../meetings/index.ts';
import { parseSharedNote, type SharedNote } from './note.ts';

export const noteSchema = 1;

type NoteFields = {
  schema: number;
  id: string;
  title: Automerge.ImmutableString;
  summary: string;
  sharedAt: number;
  deletedAt: number | null;
};

export type NoteDocument = Automerge.Doc<NoteFields>;

export type NoteState =
  | { kind: 'note'; id: string; note: SharedNote }
  | { kind: 'deleted'; id: string; deletedAt: number };

function fieldsOf(note: SharedNote): NoteFields {
  return {
    schema: noteSchema,
    id: note.id,
    title: new Automerge.ImmutableString(note.title),
    summary: note.summary,
    sharedAt: note.sharedAt,
    deletedAt: null,
  };
}

export function createNoteDocument(note: SharedNote): NoteDocument {
  return Automerge.from<NoteFields>(fieldsOf(note));
}

export function noteTombstone(id: string, deletedAt: number): NoteDocument {
  return Automerge.change(
    Automerge.init<NoteFields>({
      actor: fixedActor(`note:${id}:${deletedAt}`),
    }),
    { time: 0 },
    (fields) => {
      fields.schema = noteSchema;
      fields.id = id;
      fields.title = new Automerge.ImmutableString('');
      fields.summary = '';
      fields.sharedAt = 0;
      fields.deletedAt = deletedAt;
    },
  );
}

export function noteHeads(document: NoteDocument): string {
  return headsOf(document);
}

export function sameNoteDocument(a: NoteDocument, b: NoteDocument): boolean {
  return sameHeads(a, b);
}

// Writes only what changed between the note the caller last saw and the one
// it saves now, so edits made by other people in between are kept and text
// edits merge character by character with theirs.
export function updateNoteDocument(
  document: NoteDocument,
  previous: SharedNote,
  next: SharedNote,
): NoteDocument {
  return Automerge.change(document, (fields) => {
    if (previous.title !== next.title) {
      fields.title = new Automerge.ImmutableString(next.title);
    }
    if (previous.summary !== next.summary) {
      Automerge.updateText(fields, ['summary'], next.summary);
    }
  });
}

// Documents arrive from other people, so their shape is checked like any
// other untrusted data. A newer schema is left alone rather than misread.
export function readNoteDocument(document: NoteDocument): NoteState | null {
  const raw: unknown = Automerge.toJS(document);
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const schema = field(raw, 'schema');
  const id = field(raw, 'id');
  const deletedAt = field(raw, 'deletedAt');
  if (schema !== noteSchema || typeof id !== 'string') {
    return null;
  }
  if (typeof deletedAt === 'number') {
    return { kind: 'deleted', id, deletedAt };
  }
  const note = parseSharedNote({
    ...raw,
    title: plainValue(field(raw, 'title')),
  });
  return note ? { kind: 'note', id, note } : null;
}

export function mergeNoteDocuments(
  local: NoteDocument,
  remote: NoteDocument,
): NoteDocument {
  const mine = readNoteDocument(local);
  const theirs = readNoteDocument(remote);
  if (mine?.kind === 'deleted' || theirs?.kind === 'deleted') {
    const deletions = [mine, theirs].flatMap((state) =>
      state?.kind === 'deleted' ? [state] : [],
    );
    const first = deletions.reduce((earliest, state) =>
      state.deletedAt < earliest.deletedAt ? state : earliest,
    );
    return noteTombstone(first.id, first.deletedAt);
  }
  return mergeChanges(local, remote);
}

export function saveNoteDocument(document: NoteDocument): Uint8Array {
  return Automerge.save(document);
}

export function loadNoteDocument(
  bytes: Uint8Array,
): { document: NoteDocument; state: NoteState } | null {
  try {
    const document = Automerge.load<NoteFields>(bytes);
    const state = readNoteDocument(document);
    return state ? { document, state } : null;
  } catch {
    return null;
  }
}
