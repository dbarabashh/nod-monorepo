import {
  appendTranscript,
  folderName,
  renameMeeting,
  type Meeting,
  type TranscriptLine,
} from './meeting.ts';

const exportFormat = 'nod-meetings';
const exportVersion = 1;

export type MeetingImport = { meetings: Meeting[]; skipped: number };

export const maxImportCopies = 99;

const importedPrefix = 'imported-';
// Without underscores, which mark a deleted meeting imported again as new,
// and short enough to leave room for that mark within a meeting id.
const sourceIdPattern = /^[A-Za-z0-9-]{1,50}$/;
const isoTime =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const earliest = Date.UTC(2000, 0, 1);
const latest = Date.UTC(2100, 0, 1);
const maxOffsetMs = 7 * 24 * 60 * 60 * 1000;
// The same limits apply to a summary or line the user edits by hand. Anything
// larger is not a meeting the app could open quickly, so it is left out.
const maxSummaryChars = 100_000;
const maxLineChars = 10_000;
const maxLines = 50_000;
const maxMeetingChars = 2_000_000;

function field(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function time(value: unknown): number | null {
  if (typeof value !== 'string' || !isoTime.test(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  return parsed >= earliest && parsed < latest ? parsed : null;
}

// Larger numbers would be stored as 64-bit integers that read back as another
// type, and the meeting could never be opened again.
function offset(value: unknown): number | null {
  return typeof value === 'number' && value >= 0 && value <= maxOffsetMs
    ? Math.round(value)
    : null;
}

function line(raw: unknown, index: number, id: string): TranscriptLine | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const speaker = field(raw, 'speaker');
  const startMs = offset(field(raw, 'startMs'));
  const endMs = offset(field(raw, 'endMs'));
  const text = field(raw, 'text');
  if (
    (speaker !== 'me' && speaker !== 'others') ||
    startMs === null ||
    typeof text !== 'string'
  ) {
    return null;
  }
  return {
    // Padded so lines starting at the same moment keep the file's order once
    // stored, where ties are broken by id.
    id: `${id}-${String(index).padStart(5, '0')}`,
    speaker,
    startMs,
    endMs: Math.max(startMs, endMs ?? startMs),
    text: text.toWellFormed(),
  };
}

function textLength(entry: unknown): number {
  const text =
    typeof entry === 'object' && entry !== null ? field(entry, 'text') : null;
  return typeof text === 'string' ? text.length : 0;
}

// Each meeting is one document that opens and syncs as a whole on the main
// process, so a meeting far longer than any real conversation is left out.
function tooLarge(summary: string, transcript: unknown[]): boolean {
  let total = summary.length;
  for (const entry of transcript) {
    const length = textLength(entry);
    total += length;
    if (length > maxLineChars || total > maxMeetingChars) {
      return true;
    }
  }
  return false;
}

function meeting(raw: unknown): Meeting | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const sourceId = field(raw, 'id');
  const startedAt = time(field(raw, 'startedAt'));
  const title = field(raw, 'title');
  const summary = field(raw, 'summary') ?? '';
  const transcript = field(raw, 'transcript') ?? [];
  if (
    typeof sourceId !== 'string' ||
    !sourceIdPattern.test(sourceId) ||
    startedAt === null ||
    typeof summary !== 'string' ||
    summary.length > maxSummaryChars ||
    !Array.isArray(transcript) ||
    transcript.length > maxLines ||
    tooLarge(summary, transcript)
  ) {
    return null;
  }
  // Meeting files are named by id, and on a case-insensitive disk two ids
  // that differ only in case would share one file.
  const id = `${importedPrefix}${sourceId.toLowerCase()}`;
  const lines = transcript
    .map((entry, index) => line(entry, index, id))
    .filter((entry) => entry !== null);
  const spoken = lines.reduce(
    (latest, entry) => Math.max(latest, entry.endMs),
    0,
  );
  const endedAt = Math.max(
    startedAt,
    time(field(raw, 'endedAt')) ?? startedAt + spoken,
  );
  const trimmed = summary.toWellFormed().trim();
  const imported: Meeting = appendTranscript(
    {
      id,
      title: 'Untitled meeting',
      segments: [{ startedAt, endedAt }],
      finishedAt: endedAt,
      transcript: [],
      summary: trimmed === '' ? null : trimmed,
      summaryEdited: false,
      titleEdited: false,
      generatedTitle: null,
      folder: folderName(field(raw, 'folder')),
    },
    lines,
  );
  try {
    return typeof title === 'string'
      ? renameMeeting(imported, title.toWellFormed())
      : imported;
  } catch {
    return imported;
  }
}

// A deleted meeting stays deleted on every device, so importing it again makes
// a new meeting under the next copy's id.
export function importedCopyId(id: string, copy: number): string {
  return copy === 1 ? id : `${id}_${copy}`;
}

// Ids come from the exporting app, so importing the same file again finds the
// meetings already there instead of adding copies. A meeting listed twice is
// the same meeting, so the second one isn't counted as left out.
export function readMeetingExport(raw: unknown): MeetingImport | null {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    field(raw, 'format') !== exportFormat ||
    field(raw, 'version') !== exportVersion
  ) {
    return null;
  }
  const entries = field(raw, 'meetings');
  if (!Array.isArray(entries)) {
    return null;
  }
  const meetings = new Map<string, Meeting>();
  let skipped = 0;
  for (const entry of entries) {
    const parsed = meeting(entry);
    if (!parsed) {
      skipped += 1;
    } else if (!meetings.has(parsed.id)) {
      meetings.set(parsed.id, parsed);
    }
  }
  return { meetings: [...meetings.values()], skipped };
}
