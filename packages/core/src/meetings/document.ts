import * as Automerge from '@automerge/automerge';
import {
  parseMeeting,
  type Meeting,
  type Segment,
  type TranscriptLine,
} from './meeting.ts';

export const documentSchema = 1;

type LineFields = Omit<TranscriptLine, 'id'>;

type MeetingFields = {
  schema: number;
  id: string;
  title: string | Automerge.ImmutableString;
  segments: Segment[];
  finishedAt: number | null;
  lines: Record<string, LineFields>;
  summary: string;
  summaryEdited: boolean;
  titleEdited: boolean;
  generatedTitle: Automerge.ImmutableString | null;
  folder?: Automerge.ImmutableString | null;
  // Keyed by note id, so two devices sharing the same meeting at once keep
  // both copies.
  sharedAs?: Record<
    string,
    { target: string; kind: 'person' | 'team'; sharedAt: number }
  >;
  deletedAt: number | null;
};

export type MeetingDocument = Automerge.Doc<MeetingFields>;

export type DocumentState =
  | { kind: 'meeting'; id: string; meeting: Meeting }
  | { kind: 'deleted'; id: string; deletedAt: number };

// Names are whole values, not text: two devices naming a meeting at once
// keep one of the names rather than a mix of the letters of both.
function nameOf(value: string | null): Automerge.ImmutableString | null {
  return value === null ? null : new Automerge.ImmutableString(value);
}

export function plainValue(value: unknown): unknown {
  return value instanceof Automerge.ImmutableString ? value.toString() : value;
}

import { field } from './field.ts';

export { field };

function versionOfHeads(heads: readonly string[]): string {
  return [...heads].sort().join();
}

// Names a version of a document: equal for two documents that hold the same
// changes, on every device.
export function headsOf<T>(document: Automerge.Doc<T>): string {
  return versionOfHeads(Automerge.getHeads(document));
}

export function sameHeads<T>(
  a: Automerge.Doc<T>,
  b: Automerge.Doc<T>,
): boolean {
  return headsOf(a) === headsOf(b);
}

const changeHash = /^[0-9a-f]{64}$/;
// A document edited on many devices at once has a head for each; more than
// this is no version a person saw.
const maxHeads = 64;

function headsOfVersion(version: string): string[] | null {
  const heads = version.split(',');
  return heads.length <= maxHeads &&
    heads.every((head) => changeHash.test(head))
    ? heads
    : null;
}

export function isDocumentVersion(version: string): boolean {
  return headsOfVersion(version) !== null;
}

function seenAt<T, V>(
  document: Automerge.Doc<T>,
  heads: string[],
  read: (seen: Automerge.Doc<T>) => V | null,
): V | null {
  try {
    return read(Automerge.view(document, heads));
  } catch {
    return null;
  }
}

// A change made from the version an editor showed rather than against the
// document as it is now: Automerge merges it with whatever arrived since, so
// text another device added meanwhile is kept, not taken as deleted. Null for
// a version this document doesn't hold, or doesn't read as a value at.
//
// The version returned is the editor's own: what it showed plus this change,
// without what arrived meanwhile, which the editor hasn't shown. Its next
// save starts from there, so it can't take that text as deleted either.
export function changeFrom<T, V>(
  document: Automerge.Doc<T>,
  version: string,
  read: (seen: Automerge.Doc<T>) => V | null,
  apply: (fields: T, seen: V) => void,
): { document: Automerge.Doc<T>; version: string } | null {
  const heads = headsOfVersion(version);
  const seen = heads ? seenAt(document, heads, read) : null;
  if (!heads || seen === null) {
    return null;
  }
  // changeAt marks the document it is given as outdated, and the caller's
  // copy may still be held elsewhere. The copy keeps the device's actor, so
  // edits don't add a new one to the document each time.
  const changed = Automerge.changeAt(
    Automerge.clone(document, { actor: Automerge.getActorId(document) }),
    heads,
    (fields) => apply(fields, seen),
  );
  return {
    document: changed.newDoc,
    version: changed.newHeads ? versionOfHeads(changed.newHeads) : version,
  };
}

// Merging mutates its first argument, so the local document is cloned to
// keep the one the caller holds as it was.
export function mergeChanges<T>(
  local: Automerge.Doc<T>,
  remote: Automerge.Doc<T>,
): Automerge.Doc<T> {
  return Automerge.merge(Automerge.clone(local), remote);
}

function linesOf(meeting: Meeting): Record<string, LineFields> {
  return Object.fromEntries(
    meeting.transcript.map(({ id, ...line }) => [id, line]),
  );
}

function fieldsOf(meeting: Meeting): MeetingFields {
  return {
    schema: documentSchema,
    id: meeting.id,
    title: new Automerge.ImmutableString(meeting.title),
    segments: meeting.segments.map((segment) => ({ ...segment })),
    finishedAt: meeting.finishedAt,
    lines: linesOf(meeting),
    summary: meeting.summary ?? '',
    summaryEdited: meeting.summaryEdited,
    titleEdited: meeting.titleEdited,
    generatedTitle: nameOf(meeting.generatedTitle),
    folder: nameOf(meeting.folder),
    // Only when there is something to say: an imported meeting's first change
    // must stay the one earlier versions wrote.
    ...(meeting.sharedAs.length > 0 ? { sharedAs: sharedAsOf(meeting) } : {}),
    deletedAt: null,
  };
}

function sharedAsOf(meeting: Meeting): MeetingFields['sharedAs'] {
  return Object.fromEntries(
    meeting.sharedAs.map(({ noteId, ...copy }) => [noteId, copy]),
  );
}

export function createDocument(meeting: Meeting): MeetingDocument {
  return Automerge.from<MeetingFields>(fieldsOf(meeting));
}

function fnvHex(bytes: Uint8Array, seed: number): string {
  let hash = seed;
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// A fresh document with no history, so a deleted meeting's text doesn't live
// on in the change log of every device that syncs it. Its author and time are
// fixed, so every device builds the same bytes and they stop syncing it.
export function fixedActor(key: string): string {
  const bytes = new TextEncoder().encode(key);
  return [0x811c9dc5, 0x2f1a3b4c, 0x5e6d7c8b, 0x13572468]
    .map((seed) => fnvHex(bytes, seed))
    .join('');
}

// Devices that import the same meeting before they sync build the same first
// change, so their copies share history and later edits on either side merge
// instead of one copy replacing the other. The clone writes as its own author
// from then on: two devices writing as one would corrupt the history.
// The same author with a different first change stops the meeting syncing for
// good, so any change to how a meeting is written here (fields, schema, the
// Automerge version) must bump the encoding, which the pinned test catches.
// The author's name covers exactly the fields `import-1` knew, in that
// order; a field added to the model later stays out of it.
const importEncoding = 'import-1';

function importFingerprint(meeting: Meeting): string {
  const {
    id,
    title,
    segments,
    finishedAt,
    transcript,
    summary,
    summaryEdited,
    titleEdited,
    generatedTitle,
    folder,
  } = meeting;
  return JSON.stringify({
    id,
    title,
    segments,
    finishedAt,
    transcript,
    summary,
    summaryEdited,
    titleEdited,
    generatedTitle,
    folder,
  });
}

export function importedDocument(meeting: Meeting): MeetingDocument {
  return Automerge.clone(
    Automerge.change(
      Automerge.init<MeetingFields>({
        actor: fixedActor(
          `${importEncoding}:${documentSchema}:${importFingerprint(meeting)}`,
        ),
      }),
      { time: 0 },
      (fields) => {
        Object.assign(fields, fieldsOf(meeting));
      },
    ),
  );
}

export function tombstone(id: string, deletedAt: number): MeetingDocument {
  const actor = fixedActor(`${id}:${deletedAt}`);
  return Automerge.change(
    Automerge.init<MeetingFields>({ actor }),
    { time: 0 },
    (fields) => {
      fields.schema = documentSchema;
      fields.id = id;
      fields.title = new Automerge.ImmutableString('');
      fields.generatedTitle = null;
      fields.segments = [];
      fields.finishedAt = null;
      fields.lines = {};
      fields.summary = '';
      fields.summaryEdited = false;
      fields.titleEdited = false;
      fields.deletedAt = deletedAt;
    },
  );
}

export function documentHeads(document: MeetingDocument): string {
  return headsOf(document);
}

export function sameDocument(a: MeetingDocument, b: MeetingDocument): boolean {
  return sameHeads(a, b);
}

function setLine(fields: MeetingFields, line: TranscriptLine) {
  const current = fields.lines[line.id];
  if (!current) {
    fields.lines[line.id] = {
      speaker: line.speaker,
      startMs: line.startMs,
      endMs: line.endMs,
      text: line.text,
    };
    return;
  }
  if (current.speaker !== line.speaker) {
    current.speaker = line.speaker;
  }
  if (current.startMs !== line.startMs) {
    current.startMs = line.startMs;
  }
  if (current.endMs !== line.endMs) {
    current.endMs = line.endMs;
  }
  if (current.text !== line.text) {
    Automerge.updateText(fields, ['lines', line.id, 'text'], line.text);
  }
}

function sameSegment(a: Segment | undefined, b: Segment | undefined) {
  return a?.startedAt === b?.startedAt && a?.endedAt === b?.endedAt;
}

// Writes only what changed between the meeting the caller last saw and the
// one it saves now. A caller holding an older copy can't undo what arrived
// from another device in between, and text edits become character edits
// that merge with edits made elsewhere.
function reconcile(fields: MeetingFields, previous: Meeting, next: Meeting) {
  if (previous.title !== next.title) {
    fields.title = new Automerge.ImmutableString(next.title);
  }
  if (previous.generatedTitle !== next.generatedTitle) {
    fields.generatedTitle = nameOf(next.generatedTitle);
  }
  if (previous.folder !== next.folder) {
    fields.folder = nameOf(next.folder);
  }
  const known = new Set(previous.sharedAs.map((copy) => copy.noteId));
  for (const copy of next.sharedAs) {
    if (!known.has(copy.noteId)) {
      fields.sharedAs ??= {};
      fields.sharedAs[copy.noteId] = {
        target: copy.target,
        kind: copy.kind,
        sharedAt: copy.sharedAt,
      };
    }
  }
  next.segments.forEach((segment, index) => {
    if (sameSegment(previous.segments[index], segment)) {
      return;
    }
    const current = fields.segments[index];
    if (current) {
      current.startedAt = segment.startedAt;
      current.endedAt = segment.endedAt;
    } else {
      fields.segments.push({ ...segment });
    }
  });
  if (
    next.segments.length < previous.segments.length &&
    fields.segments.length > next.segments.length
  ) {
    fields.segments.splice(next.segments.length);
  }
  if (previous.finishedAt !== next.finishedAt) {
    fields.finishedAt = next.finishedAt;
  }
  if (previous.summaryEdited !== next.summaryEdited) {
    fields.summaryEdited = next.summaryEdited;
  }
  if (previous.titleEdited !== next.titleEdited) {
    fields.titleEdited = next.titleEdited;
  }
  const before = new Map(previous.transcript.map((line) => [line.id, line]));
  const kept = new Set(next.transcript.map((line) => line.id));
  for (const id of before.keys()) {
    if (!kept.has(id) && fields.lines[id]) {
      delete fields.lines[id];
    }
  }
  for (const line of next.transcript) {
    const old = before.get(line.id);
    if (
      !old ||
      old.text !== line.text ||
      old.speaker !== line.speaker ||
      old.startMs !== line.startMs ||
      old.endMs !== line.endMs
    ) {
      setLine(fields, line);
    }
  }
  if (previous.summary !== next.summary) {
    Automerge.updateText(fields, ['summary'], next.summary ?? '');
  }
}

export function updateDocument(
  document: MeetingDocument,
  previous: Meeting,
  next: Meeting,
): MeetingDocument {
  return Automerge.change(document, (fields) =>
    reconcile(fields, previous, next),
  );
}

export function updateDocumentFrom(
  document: MeetingDocument,
  version: string,
  edit: (seen: Meeting) => Meeting,
): { document: MeetingDocument; version: string } | null {
  return changeFrom(
    document,
    version,
    (seen) => {
      const state = readDocument(seen);
      return state?.kind === 'meeting' ? state.meeting : null;
    },
    (fields, seen) => reconcile(fields, seen, edit(seen)),
  );
}

function transcriptOf(lines: unknown): unknown[] | null {
  if (typeof lines !== 'object' || lines === null) {
    return null;
  }
  return Object.entries(lines).map(([id, line]: [string, unknown]) =>
    typeof line === 'object' && line !== null ? { ...line, id } : null,
  );
}

// Documents arrive from other devices, so their shape is checked like any
// other untrusted data. A newer schema is left alone rather than misread.
export function readDocument(document: MeetingDocument): DocumentState | null {
  const raw: unknown = Automerge.toJS(document);
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const schema = field(raw, 'schema');
  const id = field(raw, 'id');
  const deletedAt = field(raw, 'deletedAt');
  if (schema !== documentSchema || typeof id !== 'string') {
    return null;
  }
  if (typeof deletedAt === 'number') {
    return { kind: 'deleted', id, deletedAt };
  }
  const transcript = transcriptOf(field(raw, 'lines'));
  if (!transcript || transcript.some((line) => line === null)) {
    return null;
  }
  const summary = field(raw, 'summary');
  const sharedAs = field(raw, 'sharedAs');
  const meeting = parseMeeting({
    ...raw,
    title: plainValue(field(raw, 'title')),
    generatedTitle: plainValue(field(raw, 'generatedTitle')),
    folder: plainValue(field(raw, 'folder')),
    transcript,
    summary: summary === '' ? null : summary,
    // Stored as a map by note id, read as the list the model holds.
    sharedAs:
      typeof sharedAs === 'object' && sharedAs !== null
        ? Object.entries(sharedAs).map(([noteId, copy]) => ({
            noteId,
            ...(typeof copy === 'object' && copy !== null ? copy : {}),
          }))
        : [],
  });
  if (!meeting) {
    return null;
  }
  meeting.transcript.sort(
    (a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id),
  );
  return { kind: 'meeting', id, meeting };
}

export function mergeDocuments(
  local: MeetingDocument,
  remote: MeetingDocument,
): MeetingDocument {
  const mine = readDocument(local);
  const theirs = readDocument(remote);
  if (mine?.kind === 'deleted' || theirs?.kind === 'deleted') {
    const deletions = [mine, theirs].flatMap((state) =>
      state?.kind === 'deleted' ? [state] : [],
    );
    const first = deletions.reduce((earliest, state) =>
      state.deletedAt < earliest.deletedAt ? state : earliest,
    );
    return tombstone(first.id, first.deletedAt);
  }
  return mergeChanges(local, remote);
}

export function saveDocument(document: MeetingDocument): Uint8Array {
  return Automerge.save(document);
}

export function loadDocument(bytes: Uint8Array): MeetingDocument | null {
  return loadDocumentState(bytes)?.document ?? null;
}

export function loadDocumentState(
  bytes: Uint8Array,
): { document: MeetingDocument; state: DocumentState } | null {
  try {
    const document = Automerge.load<MeetingFields>(bytes);
    const state = readDocument(document);
    return state ? { document, state } : null;
  } catch {
    return null;
  }
}
