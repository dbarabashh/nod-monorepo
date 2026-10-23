import { cleanSummary, field, type Meeting } from '../meetings/index.ts';
import { isSyncId } from '../sync/layout.ts';

// What a person shares from a meeting: its name and summary, never the
// transcript, the memo or anything about audio. Once shared it is its own
// text, edited where it was shared, apart from the meeting it came from.
export type SharedNote = {
  id: string;
  title: string;
  summary: string;
  sharedAt: number;
};

export function isNoteId(id: string): boolean {
  return isSyncId(id);
}

export function noteFromMeeting(
  meeting: Meeting,
  name: string,
  id: string,
  sharedAt: number,
): SharedNote {
  return {
    id,
    title: name,
    summary: cleanSummary(meeting.summary ?? ''),
    sharedAt,
  };
}

export function editNoteSummary(note: SharedNote, summary: string): SharedNote {
  return { ...note, summary: cleanSummary(summary) };
}

export function renameNote(note: SharedNote, title: string): SharedNote {
  return { ...note, title: title.trim() };
}

// Notes arrive from other people's devices, so their shape is checked like
// any other untrusted data.
export function parseSharedNote(raw: unknown): SharedNote | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const id = field(raw, 'id');
  const title = field(raw, 'title');
  const summary = field(raw, 'summary');
  const sharedAt = field(raw, 'sharedAt');
  if (
    typeof id !== 'string' ||
    !isNoteId(id) ||
    typeof title !== 'string' ||
    typeof summary !== 'string' ||
    typeof sharedAt !== 'number' ||
    !Number.isFinite(sharedAt)
  ) {
    return null;
  }
  return { id, title, summary, sharedAt };
}
