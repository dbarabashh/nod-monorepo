import {
  appendTranscript,
  editSummary,
  editTranscriptLine,
  extendMeeting,
  finishMeeting,
  meetingName,
  meetingStartedAt,
  recordedMs,
  renameMeeting,
  resumeMeeting,
  setSummary,
  startMeeting,
  type DocumentState,
  type Meeting,
  type TranscriptLine,
} from '../../core/meetings/index.ts';
import type {
  MeetingDetail,
  MeetingSummary,
  RecordingState,
  SummaryStatus,
} from '../../shared/ipc.ts';
import type { MeetingStore } from './store.ts';

export type Recorder = {
  load: () => Promise<void>;
  list: () => Promise<MeetingSummary[]>;
  summaries: () => MeetingSummary[];
  state: () => RecordingState;
  start: (title: string) => Promise<string>;
  resume: (id: string) => Promise<void>;
  pause: () => Promise<void>;
  finish: (id: string) => Promise<void>;
  detail: (id: string) => MeetingDetail;
  transcriptOf: (id: string) => Meeting | undefined;
  appendLines: (id: string, lines: TranscriptLine[]) => Promise<void>;
  setSummaryStatus: (id: string, status: SummaryStatus) => void;
  setProblem: (id: string, problem: string | null) => void;
  saveSummary: (id: string, summary: string, title: string) => Promise<void>;
  editSummary: (id: string, markdown: string) => Promise<void>;
  editLine: (id: string, lineId: string, text: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  applyRemote: (state: DocumentState) => void;
};

export type RecorderStore = Pick<MeetingStore, 'load' | 'save' | 'remove'>;

type Active = { id: string; previousMs: number; segmentStartedAt: number };

export function createRecorder(options: {
  store: RecorderStore;
  now: () => number;
  newId: () => string;
  every: (callback: () => void) => () => void;
  onChange: () => void;
}): Recorder {
  const { store, now, newId, every, onChange } = options;
  let meetings: Meeting[] | null = null;
  let active: Active | null = null;
  let stopHeartbeat = () => {};
  const summaryStatus = new Map<string, SummaryStatus>();
  const problems = new Map<string, string>();
  let saveFailed = false;
  const revisions = new Map<string, number>();

  async function load() {
    meetings = await store.load();
  }

  // Saving over a file that failed to load would erase the meetings in it.
  function loadedMeetings(): Meeting[] {
    if (!meetings) {
      throw new Error('Saved meetings could not be read');
    }
    return meetings;
  }

  function lookup(id: string): Meeting | undefined {
    return meetings?.find((candidate) => candidate.id === id);
  }

  function find(id: string): Meeting {
    const meeting = lookup(id);
    if (!meeting) {
      throw new Error('Unknown meeting');
    }
    return meeting;
  }

  function touch(id: string) {
    revisions.set(id, (revisions.get(id) ?? 0) + 1);
  }

  function replace(meeting: Meeting) {
    meetings = loadedMeetings().map((candidate) =>
      candidate.id === meeting.id ? meeting : candidate,
    );
  }

  async function save(id: string): Promise<void> {
    try {
      await store.save(find(id));
    } catch (error) {
      if (!saveFailed) {
        saveFailed = true;
        onChange();
      }
      throw error;
    }
    if (saveFailed) {
      saveFailed = false;
      onChange();
    }
  }

  function problemOf(id: string): string | null {
    return (
      problems.get(id) ??
      (saveFailed && active?.id === id
        ? 'The latest part of this meeting couldn’t be saved. Check that there is free disk space.'
        : null)
    );
  }

  async function persist(id: string) {
    try {
      await save(id);
    } finally {
      onChange();
    }
  }

  async function update(id: string, change: (meeting: Meeting) => Meeting) {
    replace(change(find(id)));
    touch(id);
    await persist(id);
  }

  function extendActive() {
    if (active) {
      replace(extendMeeting(find(active.id), now()));
    }
  }

  async function begin(meeting: Meeting) {
    if (active) {
      throw new Error('A meeting is already being recorded');
    }
    const before = lookup(meeting.id);
    meetings = before
      ? loadedMeetings().map((candidate) =>
          candidate.id === meeting.id ? meeting : candidate,
        )
      : [...loadedMeetings(), meeting];
    active = {
      id: meeting.id,
      previousMs: recordedMs(meeting),
      segmentStartedAt: meeting.segments.at(-1)?.startedAt ?? now(),
    };
    try {
      await persist(meeting.id);
    } catch (error) {
      if (active?.id === meeting.id) {
        active = null;
      }
      meetings = before
        ? loadedMeetings().map((candidate) =>
            candidate.id === meeting.id ? before : candidate,
          )
        : loadedMeetings().filter((candidate) => candidate.id !== meeting.id);
      onChange();
      throw error;
    }
    if (active?.id !== meeting.id) {
      return;
    }
    stopHeartbeat();
    // Only the end of the current segment moves; the renderer works out the
    // elapsed time itself, so this saves without telling every window.
    stopHeartbeat = every(() => {
      extendActive();
      if (active) {
        save(active.id).catch(() => undefined);
      }
    });
  }

  async function pause() {
    if (!active) {
      return;
    }
    const { id } = active;
    stopHeartbeat();
    stopHeartbeat = () => {};
    extendActive();
    active = null;
    await persist(id);
  }

  function forget(id: string) {
    meetings = loadedMeetings().filter((meeting) => meeting.id !== id);
    summaryStatus.delete(id);
    problems.delete(id);
    revisions.delete(id);
  }

  function summaries(): MeetingSummary[] {
    return [...(meetings ?? [])]
      .sort((a, b) => meetingStartedAt(b) - meetingStartedAt(a))
      .map((meeting) => ({
        id: meeting.id,
        title: meetingName(meeting),
        startedAt: meetingStartedAt(meeting),
        recordedMs: recordedMs(meeting),
        status:
          meeting.id === active?.id
            ? 'recording'
            : meeting.finishedAt === null
              ? 'paused'
              : 'finished',
        contentVersion: `${revisions.get(meeting.id) ?? 0}:${problemOf(meeting.id) ?? ''}`,
      }));
  }

  return {
    load,
    detail: (id) => {
      const meeting = find(id);
      return {
        id,
        transcript: meeting.transcript,
        summary: meeting.summary,
        summaryEdited: meeting.summaryEdited,
        summaryStatus: summaryStatus.get(id) ?? 'idle',
        problem: problemOf(id),
      };
    },
    transcriptOf: lookup,
    appendLines: async (id, lines) => {
      if (lookup(id)) {
        await update(id, (meeting) => appendTranscript(meeting, lines));
      }
    },
    setSummaryStatus: (id, status) => {
      touch(id);
      if (status === 'idle') {
        summaryStatus.delete(id);
      } else {
        summaryStatus.set(id, status);
      }
      onChange();
    },
    setProblem: (id, problem) => {
      touch(id);
      if (problem === null) {
        problems.delete(id);
      } else {
        problems.set(id, problem);
      }
      onChange();
    },
    // A summary the user corrected while a new one was being written wins.
    saveSummary: (id, summary, title) =>
      update(id, (meeting) =>
        meeting.summaryEdited ? meeting : setSummary(meeting, summary, title),
      ),
    rename: (id, title) =>
      update(id, (meeting) => renameMeeting(meeting, title)),
    editSummary: (id, markdown) =>
      update(id, (meeting) => editSummary(meeting, markdown)),
    editLine: (id, lineId, text) =>
      update(id, (meeting) => editTranscriptLine(meeting, lineId, text)),
    list: async () => {
      if (!meetings) {
        await load();
      }
      return summaries();
    },
    summaries,
    state: () =>
      active
        ? {
            status: 'recording',
            meetingId: active.id,
            segmentStartedAt: active.segmentStartedAt,
            previousMs: active.previousMs,
          }
        : { status: 'idle' },
    start: async (title) => {
      loadedMeetings();
      const meeting = startMeeting(newId(), title, now());
      await begin(meeting);
      return meeting.id;
    },
    resume: async (id) => {
      loadedMeetings();
      await begin(resumeMeeting(find(id), now()));
    },
    pause,
    finish: async (id) => {
      if (active?.id === id) {
        await pause();
      }
      replace(finishMeeting(find(id), now()));
      await persist(id);
    },
    remove: async (id) => {
      find(id);
      if (active?.id === id) {
        throw new Error('Pause the recording before deleting this meeting');
      }
      await store.remove(id, now());
      forget(id);
      onChange();
    },
    applyRemote: (state) => {
      if (!meetings) {
        return;
      }
      if (state.kind === 'deleted') {
        if (active?.id === state.id) {
          stopHeartbeat();
          stopHeartbeat = () => {};
          active = null;
        }
        if (lookup(state.id)) {
          forget(state.id);
          onChange();
        }
        return;
      }
      meetings = lookup(state.id)
        ? meetings.map((meeting) =>
            meeting.id === state.id ? state.meeting : meeting,
          )
        : [...meetings, state.meeting];
      touch(state.id);
      onChange();
    },
  };
}
