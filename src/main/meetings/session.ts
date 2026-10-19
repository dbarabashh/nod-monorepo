import { transcriptText } from '../../core/meetings/index.ts';
import { vadFile } from '../../core/models/index.ts';
import type { ModelManager } from '../models/manager.ts';
import type { SpeechSetup, Transcriber } from '../transcription/service.ts';
import type { Recorder } from './recorder.ts';

const maxRestarts = 3;

export type MeetingSession = {
  start: (title: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  pause: () => Promise<void>;
  finish: (id: string) => Promise<void>;
  summarize: (id: string) => Promise<void>;
  acceptsAudio: () => boolean;
  captureStopped: () => void;
  transcriptionFailed: (message: string, stopped: boolean) => void;
};

export function createMeetingSession(options: {
  recorder: Recorder;
  models: ModelManager;
  transcriber: Transcriber;
  now: () => number;
  captureGraceMs: number;
}): MeetingSession {
  const { recorder, models, transcriber, now, captureGraceMs } = options;
  let draining = false;
  let releaseCapture = () => {};
  let tail: Promise<unknown> = Promise.resolve();
  let restarts = 0;

  // Start, pause and finish each await several steps; running them one at a
  // time keeps a resume from landing in the middle of a finish.
  function exclusive<T>(job: () => Promise<T>): Promise<T> {
    const result = tail.then(job);
    tail = result.catch(() => undefined);
    return result;
  }

  async function speechSetup(): Promise<SpeechSetup | null> {
    const speech = await models.installed('speech').catch(() => null);
    const model = speech?.model;
    const weights = model?.files.find((file) => file.name !== vadFile.name);
    if (!speech || model?.kind !== 'speech' || !weights) {
      return null;
    }
    return {
      engine: model.engine,
      modelPath: speech.path(weights.name),
      vadPath: speech.path(vadFile.name),
    };
  }

  function listen(setup: SpeechSetup | null) {
    const state = recorder.state();
    if (state.status !== 'recording' || !setup) {
      return;
    }
    try {
      transcriber.start(
        state.meetingId,
        state.previousMs + Math.max(0, now() - state.segmentStartedAt),
        setup,
      );
    } catch (error) {
      recorder.setProblem(state.meetingId, problemText(error));
    }
  }

  async function begin(run: () => Promise<unknown>) {
    const setup = await speechSetup();
    try {
      await run();
    } catch (error) {
      await transcriber.flush().catch(() => undefined);
      throw error;
    }
    const state = recorder.state();
    if (state.status === 'recording') {
      restarts = 0;
      recorder.setProblem(state.meetingId, null);
    }
    listen(setup);
  }

  // The renderer stops capturing only once it hears the recording paused, and
  // its last half second of audio is still on the way, so the transcript waits
  // briefly for capture to report it has stopped.
  function captureDone(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, captureGraceMs);
      releaseCapture = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  // The flush is sent while the lock is held, so it reaches the transcriber
  // before any later start, but it is awaited outside: it can wait a long time
  // behind the transcriber's backlog, and a new meeting shouldn't.
  async function stop(): Promise<{ flushed: Promise<void> }> {
    const state = recorder.state();
    let flushed = Promise.resolve();
    const captured =
      state.status === 'recording' ? captureDone() : Promise.resolve();
    draining = state.status === 'recording';
    try {
      await recorder.pause();
    } finally {
      if (state.status === 'recording') {
        await captured;
        draining = false;
        const id = state.meetingId;
        flushed = transcriber.flush().catch((error: unknown) => {
          recorder.setProblem(id, partLost(error));
        });
      }
    }
    return { flushed };
  }

  async function summarize(id: string) {
    const meeting = recorder.transcriptOf(id);
    if (
      !meeting ||
      meeting.finishedAt === null ||
      meeting.transcript.length === 0 ||
      meeting.summaryEdited ||
      recorder.detail(id).summaryStatus === 'writing'
    ) {
      return;
    }
    recorder.setSummaryStatus(id, 'writing');
    try {
      const summaryModel = await models.installed('summary');
      const weights = summaryModel?.model.files[0];
      if (!summaryModel || !weights) {
        recorder.setSummaryStatus(id, 'idle');
        return;
      }
      await recorder.saveSummary(
        id,
        await transcriber.summarize(
          summaryModel.path(weights.name),
          transcriptText(meeting),
        ),
      );
      recorder.setSummaryStatus(id, 'idle');
    } catch (error) {
      recorder.setSummaryStatus(id, 'failed');
      throw error;
    }
  }

  return {
    start: (title) => exclusive(() => begin(() => recorder.start(title))),
    resume: (id) => exclusive(() => begin(() => recorder.resume(id))),
    pause: async () => {
      const { flushed } = await exclusive(stop);
      await flushed;
    },
    finish: async (id) => {
      const { flushed, finished } = await exclusive(async () => {
        const state = recorder.state();
        const { flushed } =
          state.status === 'recording' && state.meetingId === id
            ? await stop()
            : { flushed: Promise.resolve() };
        if ((recorder.transcriptOf(id)?.finishedAt ?? null) !== null) {
          return { flushed, finished: false };
        }
        await recorder.finish(id);
        return { flushed, finished: true };
      });
      await flushed;
      if (finished) {
        void summarize(id).catch(() => undefined);
      }
    },
    summarize,
    acceptsAudio: () => draining || recorder.state().status === 'recording',
    captureStopped: () => releaseCapture(),
    transcriptionFailed: (message, stopped) => {
      const state = recorder.state();
      if (state.status !== 'recording') {
        return;
      }
      if (stopped && restarts < maxRestarts) {
        restarts += 1;
        recorder.setProblem(
          state.meetingId,
          'Transcription restarted after an error, so a few seconds may be missing.',
        );
        void exclusive(async () => listen(await speechSetup()));
        return;
      }
      recorder.setProblem(
        state.meetingId,
        stopped ? `Transcription stopped: ${message}` : partLost(message),
      );
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function problemText(error: unknown): string {
  return `Transcription couldn’t start: ${messageOf(error)}`;
}

function partLost(error: unknown): string {
  return `Part of the transcript couldn’t be made: ${messageOf(error)}`;
}
