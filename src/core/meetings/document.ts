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

function plainValue(value: unknown): unknown {
  return value instanceof Automerge.ImmutableString ? value.toString() : value;
}

function linesOf(meeting: Meeting): Record<string, LineFields> {
  return Object.fromEntries(
    meeting.transcript.map(({ id, ...line }) => [id, line]),
  );
}

export function createDocument(meeting: Meeting): MeetingDocument {
  return Automerge.from<MeetingFields>({
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
    deletedAt: null,
  });
}

function fnvHex(text: string, seed: number): string {
  let hash = seed;
  for (const byte of new TextEncoder().encode(text)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// A fresh document with no history, so a deleted meeting's text doesn't live
// on in the change log of every device that syncs it. Its author and time are
// fixed, so every device builds the same bytes and they stop syncing it.
export function tombstone(id: string, deletedAt: number): MeetingDocument {
  const key = `${id}:${deletedAt}`;
  const actor = [0x811c9dc5, 0x2f1a3b4c, 0x5e6d7c8b, 0x13572468]
    .map((seed) => fnvHex(key, seed))
    .join('');
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

export function sameDocument(a: MeetingDocument, b: MeetingDocument): boolean {
  const heads = (document: MeetingDocument) =>
    [...Automerge.getHeads(document)].sort().join();
  return heads(a) === heads(b);
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

function field(value: object, key: string): unknown {
  return Reflect.get(value, key);
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
  const meeting = parseMeeting({
    ...raw,
    title: plainValue(field(raw, 'title')),
    generatedTitle: plainValue(field(raw, 'generatedTitle')),
    folder: plainValue(field(raw, 'folder')),
    transcript,
    summary: summary === '' ? null : summary,
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
  return Automerge.merge(Automerge.clone(local), remote);
}

export function saveDocument(document: MeetingDocument): Uint8Array {
  return Automerge.save(document);
}

export function loadDocument(bytes: Uint8Array): MeetingDocument | null {
  try {
    const document = Automerge.load<MeetingFields>(bytes);
    return readDocument(document) ? document : null;
  } catch {
    return null;
  }
}
