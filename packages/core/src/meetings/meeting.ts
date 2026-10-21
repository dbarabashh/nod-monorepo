export type Segment = {
  startedAt: number;
  endedAt: number;
};

export type Speaker = 'me' | 'others';

export type TranscriptLine = {
  id: string;
  speaker: Speaker;
  startMs: number;
  endMs: number;
  text: string;
};

export type Meeting = {
  id: string;
  title: string;
  segments: Segment[];
  finishedAt: number | null;
  transcript: TranscriptLine[];
  summary: string | null;
  summaryEdited: boolean;
  titleEdited: boolean;
  generatedTitle: string | null;
  folder: string | null;
};

export function startMeeting(id: string, title: string, now: number): Meeting {
  return {
    id,
    title,
    segments: [{ startedAt: now, endedAt: now }],
    finishedAt: null,
    transcript: [],
    summary: null,
    summaryEdited: false,
    titleEdited: false,
    generatedTitle: null,
    folder: null,
  };
}

export function resumeMeeting(meeting: Meeting, now: number): Meeting {
  if (meeting.finishedAt !== null) {
    throw new Error('A finished meeting cannot be resumed');
  }
  return {
    ...meeting,
    segments: [...meeting.segments, { startedAt: now, endedAt: now }],
  };
}

export function extendMeeting(meeting: Meeting, now: number): Meeting {
  const last = meeting.segments.at(-1);
  if (!last || now <= last.endedAt) {
    return meeting;
  }
  return {
    ...meeting,
    segments: [...meeting.segments.slice(0, -1), { ...last, endedAt: now }],
  };
}

export function finishMeeting(meeting: Meeting, now: number): Meeting {
  return meeting.finishedAt === null
    ? { ...meeting, finishedAt: now }
    : meeting;
}

export function appendTranscript(
  meeting: Meeting,
  lines: TranscriptLine[],
): Meeting {
  const cleaned = lines
    .map((line) => ({ ...line, text: line.text.trim() }))
    .filter(
      (line) =>
        line.text !== '' &&
        Number.isFinite(line.startMs) &&
        Number.isFinite(line.endMs),
    );
  if (cleaned.length === 0) {
    return meeting;
  }
  return {
    ...meeting,
    transcript: [...meeting.transcript, ...cleaned].sort(
      (a, b) => a.startMs - b.startMs,
    ),
  };
}

const maxTitleLength = 80;

// Control characters and direction overrides could hide or reorder what a
// name shows, so they never get into one.
function plainName(text: string): string {
  return text
    .replace(/[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function capped(name: string): string {
  const characters = [...name];
  return characters.length > maxTitleLength
    ? `${characters
        .slice(0, maxTitleLength - 1)
        .join('')
        .trimEnd()}…`
    : name;
}

// Models wrap a title in quotes, a "Title:" label, Markdown or thinking
// tags, and end it with a full stop; none of that belongs in a name.
export function cleanTitle(raw: string): string | null {
  const lines = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) => line !== '' && !/^(?:meeting\s+)?title\s*:?$/i.test(line),
    );
  const quotes = /^["'“”‘’«»]+|["'“”‘’«»]+$/g;
  const title = plainName(
    (lines[0] ?? '')
      .replace(/^#+\s*/, '')
      .replace(/^\*{1,2}(.*?)\*{1,2}$/, '$1')
      .replace(quotes, '')
      .replace(/^(?:meeting\s+)?title\s*:\s*/i, '')
      .replace(/[.。]+$/, '')
      .replace(quotes, ''),
  );
  return title === '' ? null : capped(title);
}

// A name the user gave wins; then the one the summary model wrote; then the
// one the meeting started with.
export function meetingName(meeting: Meeting): string {
  return meeting.titleEdited
    ? meeting.title
    : (meeting.generatedTitle ?? meeting.title);
}

export function setSummary(
  meeting: Meeting,
  summary: string,
  title: string | null = null,
): Meeting {
  return {
    ...meeting,
    generatedTitle:
      (title === null ? null : cleanTitle(title)) ?? meeting.generatedTitle,
    summary: cleanSummary(summary),
    summaryEdited: false,
  };
}

export function renameMeeting(meeting: Meeting, title: string): Meeting {
  const named = plainName(title);
  if (named === '') {
    throw new Error('A meeting needs a name');
  }
  return { ...meeting, title: capped(named), titleEdited: true };
}

// A folder is only a label, so a name from another device that this version
// can't use files the meeting under no folder instead of hiding the meeting.
export function folderName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const named = plainName(value.normalize('NFC'));
  return named === '' ? null : capped(named);
}

export function moveToFolder(meeting: Meeting, folder: string | null): Meeting {
  if (folder === null) {
    return { ...meeting, folder: null };
  }
  const named = folderName(folder);
  if (named === null) {
    throw new Error('A folder needs a name');
  }
  return { ...meeting, folder: named };
}

export function editSummary(meeting: Meeting, markdown: string): Meeting {
  const summary = markdown.trim();
  return summary === ''
    ? { ...meeting, summary: null, summaryEdited: false }
    : { ...meeting, summary, summaryEdited: true };
}

export function editTranscriptLine(
  meeting: Meeting,
  lineId: string,
  text: string,
): Meeting {
  const index = meeting.transcript.findIndex((line) => line.id === lineId);
  const line = meeting.transcript[index];
  if (!line) {
    throw new Error('That line is no longer in the transcript');
  }
  const trimmed = text.trim();
  return {
    ...meeting,
    transcript:
      trimmed === ''
        ? meeting.transcript.toSpliced(index, 1)
        : meeting.transcript.with(index, { ...line, text: trimmed }),
  };
}

// The summary is shown under its own "Summary" title, so a model that starts
// with that heading anyway would repeat it.
export function cleanSummary(summary: string): string {
  return summary
    .trim()
    .replace(
      /^(?:#{1,6}\s*)?(?:\*\*)?summary:?(?:\*\*)?:?[ \t]*(?:\r?\n|$)/i,
      '',
    )
    .trim();
}

function speakerLabel(speaker: Speaker): string {
  return speaker === 'me' ? 'Me' : 'Others';
}

export function transcriptText(meeting: Meeting): string {
  return meeting.transcript
    .map((line) => `${speakerLabel(line.speaker)}: ${line.text}`)
    .join('\n');
}

export type MeetingPart = 'summary' | 'transcript';

function formatOffset(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

export function meetingText(meeting: Meeting, part: MeetingPart): string {
  if (part === 'summary') {
    return meeting.summary ?? '';
  }
  return meeting.transcript
    .map(
      (line) =>
        `[${formatOffset(line.startMs)}] ${speakerLabel(line.speaker)}: ${line.text}`,
    )
    .join('\n');
}

export function meetingStartedAt(meeting: Meeting): number {
  return meeting.segments[0]?.startedAt ?? 0;
}

export function recordedMs(meeting: Meeting): number {
  return meeting.segments.reduce(
    (total, segment) => total + (segment.endedAt - segment.startedAt),
    0,
  );
}

function field(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function parseSegment(raw: unknown): Segment | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const startedAt = field(raw, 'startedAt');
  const endedAt = field(raw, 'endedAt');
  if (
    typeof startedAt !== 'number' ||
    typeof endedAt !== 'number' ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endedAt) ||
    endedAt < startedAt
  ) {
    return null;
  }
  return { startedAt, endedAt };
}

// Files written before lines had ids get ones derived from their position, so
// reading the same file twice gives the same ids.
function parseLine(
  raw: unknown,
  index: number,
  meetingId: string,
): TranscriptLine | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const id = field(raw, 'id') ?? `${meetingId}-${index}`;
  const speaker = field(raw, 'speaker');
  const startMs = field(raw, 'startMs');
  const endMs = field(raw, 'endMs');
  const text = field(raw, 'text');
  if (
    typeof id !== 'string' ||
    (speaker !== 'me' && speaker !== 'others') ||
    typeof startMs !== 'number' ||
    typeof endMs !== 'number' ||
    typeof text !== 'string'
  ) {
    return null;
  }
  return { id, speaker, startMs, endMs, text };
}

export function parseMeeting(raw: unknown): Meeting | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const id = field(raw, 'id');
  const title = field(raw, 'title');
  const segments = field(raw, 'segments');
  const finishedAt = field(raw, 'finishedAt') ?? null;
  const transcript = field(raw, 'transcript') ?? [];
  const summary = field(raw, 'summary') ?? null;
  const summaryEdited = field(raw, 'summaryEdited') ?? false;
  const titleEdited = field(raw, 'titleEdited') ?? false;
  const generatedTitle = field(raw, 'generatedTitle') ?? null;
  if (
    typeof id !== 'string' ||
    typeof title !== 'string' ||
    !Array.isArray(segments) ||
    !(finishedAt === null || typeof finishedAt === 'number') ||
    !Array.isArray(transcript) ||
    !(summary === null || typeof summary === 'string') ||
    typeof summaryEdited !== 'boolean' ||
    typeof titleEdited !== 'boolean' ||
    !(generatedTitle === null || typeof generatedTitle === 'string')
  ) {
    return null;
  }
  const parsed = segments.map(parseSegment);
  const lines = transcript.map((line, index) => parseLine(line, index, id));
  if (
    parsed.length === 0 ||
    parsed.some((segment) => segment === null) ||
    lines.some((line) => line === null)
  ) {
    return null;
  }
  return {
    id,
    title,
    segments: parsed.filter((segment) => segment !== null),
    finishedAt,
    transcript: lines.filter((line) => line !== null),
    summary,
    summaryEdited,
    titleEdited,
    generatedTitle,
    folder: folderName(field(raw, 'folder')),
  };
}
