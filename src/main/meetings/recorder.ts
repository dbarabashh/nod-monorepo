import {
  appendTranscript,
  extendMeeting,
  finishMeeting,
  meetingStartedAt,
  recordedMs,
  resumeMeeting,
  setSummary,
  startMeeting,
  type Meeting,
  type TranscriptLine,
} from '../../core/meetings/index.ts';
import type {
  MeetingDetail,
  MeetingSummary,
  RecordingState,
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
  setSummarizing: (id: string, summarizing: boolean) => void;
  saveSummary: (id: string, summary: string) => Promise<void>;
};

type Active = { id: string; previousMs: number; segmentStartedAt: number };

export function createRecorder(options: {
  store: MeetingStore;
  now: () => number;
  newId: () => string;
  every: (callback: () => void) => () => void;
  onChange: () => void;
}): Recorder {
  const { store, now, newId, every, onChange } = options;
  let meetings: Meeting[] | null = null;
  let active: Active | null = null;
  let stopHeartbeat = () => {};
  const summarizing = new Set<string>();

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

  function replace(meeting: Meeting) {
    meetings = loadedMeetings().map((candidate) =>
      candidate.id === meeting.id ? meeting : candidate,
    );
  }

  function save(): Promise<void> {
    return store.save(loadedMeetings());
  }

  async function persist() {
    try {
      await save();
    } finally {
      onChange();
    }
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
    const previous = loadedMeetings();
    meetings = lookup(meeting.id)
      ? previous.map((candidate) =>
          candidate.id === meeting.id ? meeting : candidate,
        )
      : [...previous, meeting];
    active = {
      id: meeting.id,
      previousMs: recordedMs(meeting),
      segmentStartedAt: meeting.segments.at(-1)?.startedAt ?? now(),
    };
    try {
      await persist();
    } catch (error) {
      active = null;
      meetings = previous;
      onChange();
      throw error;
    }
    // Only the end of the current segment moves; the renderer works out the
    // elapsed time itself, so this saves without telling every window.
    stopHeartbeat = every(() => {
      extendActive();
      save().catch(() => undefined);
    });
  }

  async function pause() {
    if (!active) {
      return;
    }
    stopHeartbeat();
    extendActive();
    active = null;
    await persist();
  }

  function summaries(): MeetingSummary[] {
    return [...(meetings ?? [])]
      .sort((a, b) => meetingStartedAt(b) - meetingStartedAt(a))
      .map((meeting) => ({
        id: meeting.id,
        title: meeting.title,
        startedAt: meetingStartedAt(meeting),
        recordedMs: recordedMs(meeting),
        status:
          meeting.id === active?.id
            ? 'recording'
            : meeting.finishedAt === null
              ? 'paused'
              : 'finished',
        contentVersion: `${meeting.transcript.length}:${meeting.summary?.length ?? 0}:${summarizing.has(meeting.id)}`,
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
        summarizing: summarizing.has(id),
      };
    },
    transcriptOf: lookup,
    appendLines: async (id, lines) => {
      const meeting = lookup(id);
      if (meeting) {
        replace(appendTranscript(meeting, lines));
        await persist();
      }
    },
    setSummarizing: (id, value) => {
      if (value) {
        summarizing.add(id);
      } else {
        summarizing.delete(id);
      }
      onChange();
    },
    saveSummary: async (id, summary) => {
      replace(setSummary(find(id), summary));
      await persist();
    },
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
      await persist();
    },
  };
}
