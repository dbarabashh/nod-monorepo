import {
  appendTranscript,
  extendMeeting,
  finishMeeting,
  recordedMs,
  resumeMeeting,
  startMeeting,
  type Meeting,
  type MeetingStore,
  type Speaker,
} from '@nod/core/meetings';
import {
  append,
  drainSpeech,
  emptyBuffer,
  type AudioBuffer,
  type ChunkOptions,
  type SpeechEngine,
} from '@nod/core/transcription';
import { messageOf } from '../message-of.ts';

export type Interruption = 'began' | 'ended' | 'lost';

export type Microphone = {
  start: (
    onAudio: (pcm: Int16Array) => void,
    onInterruption: (state: Interruption) => void,
  ) => Promise<void>;
  stop: () => Promise<void>;
  // Lets the system suspend the app again once what was recorded is saved;
  // until then a stopped microphone keeps it running in the background.
  release: () => Promise<void>;
};

export type LoadedEngine = SpeechEngine & { release: () => Promise<void> };

export type RecorderState =
  | { status: 'idle'; problem: string | null }
  | {
      status: 'recording';
      meetingId: string;
      segmentStartedAt: number;
      // What the meeting had recorded before this segment, so the clock
      // goes on from there after a pause, as on the computer.
      previousMs: number;
      interrupted: boolean;
      problem: string | null;
    }
  | { status: 'paused'; meetingId: string; problem: string | null };

const drainEveryMs = 2_000;
// The model stays loaded a while after recording stops, so resuming or the
// next meeting starts at once; then its memory is given back.
const keepWarmMs = 2 * 60_000;
const heartbeatMs = 5_000;
const samplesPerMs = 16;
// Shorter than the computer's: without a pause in speech a chunk waits until
// it is this long, and on a phone's CPU a long chunk also takes long to
// transcribe, so lines would show up half a minute late.
const phoneChunks: ChunkOptions = {
  tailMs: 600,
  maxBufferMs: 12_000,
  maxChunkMs: 10_000,
};
// What waits to be transcribed is capped: a phone that can't keep up skips
// what waits rather than run out of memory over a long meeting.
const maxBacklogMs = 3 * 60_000;
// One phone microphone hears everyone in the room, so nothing marks the
// person holding it apart from the others.
const speaker: Speaker = 'others';

export type PhoneRecorder = ReturnType<typeof createPhoneRecorder>;

// Records one meeting at a time: audio goes to the speech engine in memory,
// and the transcript is saved every few seconds, so a crash or a kill by the
// system loses seconds, not the conversation. Like the computer, a meeting
// can be paused and resumed, and is finished on purpose. Starting and
// stopping take effect at once: the microphone opens while the model loads,
// and what is left to transcribe after a stop is finished in the background.
export function createPhoneRecorder(options: {
  store: MeetingStore;
  microphone: Microphone;
  loadEngine: () => Promise<LoadedEngine>;
  title: (now: number) => string;
  newId: () => string;
  now: () => number;
  every: (ms: number, run: () => void) => () => void;
  later: (ms: number, run: () => void) => () => void;
  onChange: () => void;
  // The meeting the microphone is recording, or null once it stops.
  onRecording?: (meetingId: string | null) => void;
}) {
  const { store, microphone, newId, now, every, later, onChange } = options;
  let state: RecorderState = { status: 'idle', problem: null };
  let engine: LoadedEngine | null = null;
  let loading: Promise<LoadedEngine> | null = null;
  let cooling: (() => void) | null = null;
  let buffer: AudioBuffer = emptyBuffer(0);
  let timers: Array<() => void> = [];
  let saving: Promise<void> = Promise.resolve();
  let draining: Promise<void> | null = null;
  let settling: Promise<void> = Promise.resolve();
  // Stops whose transcript is still being finished, per meeting: a pause and
  // a finish can both be settling for the same one.
  const unsettled = new Map<string, number>();
  let loadFailed = false;
  let opening = false;
  let queue: Promise<unknown> = Promise.resolve();
  let starting: Promise<string> | null = null;
  let pausing: Promise<void> | null = null;
  let finishing: Promise<void> | null = null;

  function report(problem: string) {
    state = { ...state, problem };
    onChange();
  }

  // A problem with a meeting that has stopped is shown only while no other
  // meeting is recording.
  function reportFor(id: string, problem: string) {
    if (state.status === 'idle' || state.meetingId === id) {
      report(problem);
    }
  }

  function idle() {
    return unsettled.size === 0 && state.status !== 'recording' && !opening;
  }

  // The model and the system's leave to run in the background are given
  // back only when nothing records, starts or is still being transcribed.
  async function releaseIfIdle() {
    if (idle()) {
      coolLater();
      await microphone.release().catch(() => undefined);
    }
  }

  // Starting, pausing and finishing happen one after another, so a second
  // tap, or the microphone going away while the user stops, never opens a
  // second microphone or transcribes the same audio twice.
  function enqueue<T>(step: () => Promise<T>): Promise<T> {
    const next = queue.then(step);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  // One model, used by one job at a time: the end of the last recording is
  // still being transcribed when the next one starts.
  function serialized(loaded: LoadedEngine): LoadedEngine {
    let chain: Promise<unknown> = Promise.resolve();
    const one = <T>(job: () => Promise<T>): Promise<T> => {
      const next = chain.then(job);
      chain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    };
    return {
      detectSpeech: (audio) => one(() => loaded.detectSpeech(audio)),
      transcribe: (pcm) => one(() => loaded.transcribe(pcm)),
      release: () => one(() => loaded.release()),
    };
  }

  function warmEngine(): Promise<LoadedEngine> {
    cooling?.();
    cooling = null;
    if (engine) {
      return Promise.resolve(engine);
    }
    loading ??= options
      .loadEngine()
      .then((loaded) => {
        engine = serialized(loaded);
        return engine;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  function coolLater() {
    cooling?.();
    cooling = later(keepWarmMs, () => {
      cooling = null;
      if (state.status === 'recording') {
        return;
      }
      if (loading || !idle()) {
        coolLater();
        return;
      }
      const loaded = engine;
      engine = null;
      void loaded?.release().catch(() => undefined);
    });
  }

  // Changes are made to the meeting as the store last saved it, one at a
  // time, so a rename or deletion from another device in between is kept.
  function change(id: string, edit: (meeting: Meeting) => Meeting) {
    const next = saving.then(async () => {
      const current = store.meeting(id);
      if (current) {
        await store.save(edit(current));
      } else if (state.status !== 'idle' && state.meetingId === id) {
        report(
          'This meeting was deleted on another device, so recording stopped.',
        );
        void finish();
      }
    });
    saving = next.catch((failure: unknown) => {
      reportFor(id, `The transcript couldn’t be saved: ${messageOf(failure)}`);
    });
    return saving;
  }

  // While the model loads, audio waits in memory rather than being dropped;
  // only the last part of a segment waits for the model if it must.
  async function drain(id: string, audio: AudioBuffer, final: boolean) {
    const ready =
      final && !loadFailed ? await warmEngine().catch(() => null) : engine;
    if (!ready) {
      if (final && !loadFailed && audio.samples > 0) {
        reportFor(
          id,
          'The end of the meeting couldn’t be transcribed, because the speech model didn’t load.',
        );
      }
      return;
    }
    try {
      await drainSpeech({
        buffer: audio,
        speaker,
        engine: ready,
        final,
        newId,
        chunks: phoneChunks,
        onLine: (line) =>
          change(id, (meeting) => appendTranscript(meeting, [line])),
      });
    } catch (failure) {
      reportFor(
        id,
        `Part of the meeting couldn’t be transcribed: ${messageOf(failure)}`,
      );
    }
  }

  function drainSoon(id: string) {
    draining ??= drain(id, buffer, false).finally(() => {
      draining = null;
    });
  }

  function onAudio(pcm: Int16Array) {
    append(buffer, pcm);
    if (buffer.samples > maxBacklogMs * samplesPerMs) {
      buffer = emptyBuffer(buffer.baseMs + buffer.samples / samplesPerMs);
      report(
        'This phone couldn’t keep up, so part of the meeting wasn’t transcribed. A smaller model keeps up better.',
      );
    }
  }

  // A call pauses the audio for a moment; a microphone that is gone pauses
  // the meeting, which can then be resumed.
  function onInterruption(interruption: Interruption) {
    if (interruption === 'lost') {
      report('The microphone stopped, so recording paused.');
      void pause();
    } else if (state.status === 'recording') {
      state = { ...state, interrupted: interruption === 'began' };
      onChange();
    }
  }

  // The meeting is saved only once the microphone is open. The model loads
  // meanwhile; if it can't, the meeting pauses and says why.
  async function begin(resumeId: string | null): Promise<string> {
    if (state.status === 'recording') {
      return state.meetingId;
    }
    await saving;
    let meeting: Meeting;
    if (resumeId === null) {
      const at = now();
      meeting = startMeeting(newId(), options.title(at), at);
    } else {
      const stored = store.meeting(resumeId);
      if (!stored || stored.finishedAt !== null) {
        throw new Error('This meeting can’t be resumed');
      }
      meeting = stored;
    }
    const previousMs = resumeId === null ? 0 : recordedMs(meeting);
    buffer = emptyBuffer(previousMs);
    const segmentStartedAt = now();
    loadFailed = false;
    let begun = false;
    let loadProblem: string | null = null;
    const failLoad = (problem: string) => {
      report(problem);
      void pause();
    };
    void warmEngine().catch((failure: unknown) => {
      loadFailed = true;
      const problem = `The speech model couldn’t load: ${messageOf(failure)}`;
      if (begun) {
        failLoad(problem);
      } else {
        loadProblem = problem;
      }
    });
    try {
      opening = true;
      await microphone.start(onAudio, onInterruption).finally(() => {
        opening = false;
      });
      if (resumeId === null) {
        await store.save(meeting);
      } else {
        // Saved directly rather than through change(), so a meeting finished
        // or deleted elsewhere meanwhile fails the resume instead of being
        // recorded into.
        await saving;
        const current = store.meeting(resumeId);
        if (!current) {
          throw new Error('This meeting was deleted on another device');
        }
        await store.save(resumeMeeting(current, segmentStartedAt));
      }
    } catch (failure) {
      await microphone.stop().catch(() => undefined);
      void releaseIfIdle();
      throw failure;
    }
    const id = meeting.id;
    state = {
      status: 'recording',
      meetingId: id,
      segmentStartedAt,
      previousMs,
      interrupted: false,
      problem: null,
    };
    timers = [
      every(drainEveryMs, () => drainSoon(id)),
      every(heartbeatMs, () => {
        void change(id, (current) => extendMeeting(current, now()));
      }),
    ];
    options.onRecording?.(id);
    onChange();
    begun = true;
    if (loadProblem !== null) {
      failLoad(loadProblem);
    }
    return id;
  }

  async function end(finished: boolean) {
    if (state.status === 'paused' && finished) {
      const id = state.meetingId;
      await change(id, (meeting) =>
        finishMeeting(meeting, meeting.segments.at(-1)?.endedAt ?? now()),
      );
      state = { status: 'idle', problem: state.problem };
      onChange();
      return;
    }
    if (state.status !== 'recording') {
      return;
    }
    const id = state.meetingId;
    const endedAt = now();
    const audio = buffer;
    const pending = draining;
    for (const clear of timers) {
      clear();
    }
    timers = [];
    await microphone.stop().catch(() => undefined);
    buffer = emptyBuffer(0);
    // Finished at once, so a phone killed while the end is still being
    // transcribed leaves a finished meeting missing a few lines, not one
    // that looks paused forever.
    void change(id, (meeting) =>
      finished
        ? finishMeeting(extendMeeting(meeting, endedAt), endedAt)
        : extendMeeting(meeting, endedAt),
    );
    state =
      finished || store.meeting(id) === undefined
        ? { status: 'idle', problem: state.problem }
        : { status: 'paused', meetingId: id, problem: state.problem };
    unsettled.set(id, (unsettled.get(id) ?? 0) + 1);
    options.onRecording?.(null);
    onChange();
    settling = settling
      .then(async () => {
        await pending;
        await drain(id, audio, true);
        await saving;
      })
      .catch(() => undefined)
      .then(async () => {
        const left = (unsettled.get(id) ?? 1) - 1;
        if (left > 0) {
          unsettled.set(id, left);
        } else {
          unsettled.delete(id);
        }
        onChange();
        await releaseIfIdle();
      });
  }

  function pause(): Promise<void> {
    pausing ??= enqueue(() => end(false)).finally(() => {
      pausing = null;
    });
    return pausing;
  }

  function finish(): Promise<void> {
    finishing ??= enqueue(() => end(true)).finally(() => {
      finishing = null;
    });
    return finishing;
  }

  return {
    state: () => state,
    start: (): Promise<string> => {
      starting ??= enqueue(() => begin(null)).finally(() => {
        starting = null;
      });
      return starting;
    },
    resume: (meetingId: string): Promise<string> => {
      starting ??= enqueue(() => begin(meetingId)).finally(() => {
        starting = null;
      });
      return starting;
    },
    pause,
    finish,
    // Settles once what was left to transcribe after a stop is saved.
    settled: (): Promise<void> => settling,
    // Whether the end of this meeting's recording is still being transcribed.
    transcribing: (meetingId: string): boolean => unsettled.has(meetingId),
  };
}
