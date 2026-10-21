import { transcriptText } from '@nod/core/meetings';
import { vadFile } from '@nod/core/models';
import type { ModelManager } from '../models/manager.ts';
import type {
  SpeechSetup,
  Transcriber,
  TranscriptionTrouble,
} from '../transcription/service.ts';
import type { Recorder } from './recorder.ts';

const maxRestarts = 3;
const noSpeechModel =
  'Transcription needs a speech model. Download one in Settings → Transcription, then start again.';
const pausedNoSpeechModel =
  'Recording paused: transcription needs a speech model. Download one in Settings → Transcription, then resume.';
const speechModelDownloading =
  'The speech model is still downloading. Start recording once it is ready.';

export type MeetingSession = {
  start: (title: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  pause: () => Promise<void>;
  finish: (id: string) => Promise<void>;
  summarize: (id: string) => Promise<void>;
  acceptsAudio: () => boolean;
  captureStopped: () => void;
  transcriptionFailed: (
    meetingId: string,
    trouble: TranscriptionTrouble,
    message: string,
    current: boolean,
  ) => void;
};

export function createMeetingSession(options: {
  recorder: Recorder;
  models: ModelManager;
  transcriber: Transcriber;
  now: () => number;
  captureGraceMs: number;
  // The page that captured the recording sent its last audio, or stopped
  // being waited for.
  onCaptureFinished?: () => void;
}): MeetingSession {
  const { recorder, models, transcriber, now, captureGraceMs } = options;
  let draining = false;
  let releaseCapture = () => {};
  let tail: Promise<unknown> = Promise.resolve();
  let restarts = 0;
  let listens = 0;

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

  function listen(setup: SpeechSetup | null): string | null {
    const state = recorder.state();
    if (state.status !== 'recording') {
      return null;
    }
    if (!setup) {
      return pausedNoSpeechModel;
    }
    try {
      transcriber.start(
        state.meetingId,
        state.previousMs + Math.max(0, now() - state.segmentStartedAt),
        setup,
      );
      listens += 1;
      return null;
    } catch (error) {
      return problemText(error);
    }
  }

  // Audio is never kept, so a recording nothing transcribes is paused rather
  // than left running with its words lost. Runs inside the lock.
  async function halt(id: string, problem: string) {
    const state = recorder.state();
    if (state.status !== 'recording' || state.meetingId !== id) {
      return;
    }
    const explain = () => {
      const now = recorder.state();
      if (now.status !== 'recording' || now.meetingId !== id) {
        recorder.setProblem(id, problem);
      }
    };
    try {
      const { flushed } = await stop();
      void flushed.then(explain);
    } catch (error) {
      explain();
      throw error;
    }
  }

  async function begin(run: () => Promise<unknown>) {
    const setup = await speechSetup();
    if (!setup) {
      const downloading = (await models.list().catch(() => [])).some(
        (model) => model.kind === 'speech' && model.status === 'downloading',
      );
      throw new Error(downloading ? speechModelDownloading : noSpeechModel);
    }
    try {
      await run();
    } catch (error) {
      await transcriber.flush().catch(() => undefined);
      throw error;
    }
    const state = recorder.state();
    if (state.status !== 'recording') {
      return;
    }
    restarts = 0;
    recorder.setProblem(state.meetingId, null);
    const problem = listen(setup);
    if (problem !== null) {
      await halt(state.meetingId, problem);
      throw new Error(problem);
    }
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
        options.onCaptureFinished?.();
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
      const { summary, title } = await transcriber.summarize(
        summaryModel.path(weights.name),
        transcriptText(meeting),
      );
      await recorder.saveSummary(id, summary, title);
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
    transcriptionFailed: (meetingId, trouble, message, current) => {
      const state = recorder.state();
      const live =
        current &&
        state.status === 'recording' &&
        state.meetingId === meetingId;
      if (trouble === 'part-lost' || !live) {
        recorder.setProblem(meetingId, partLost(message));
        return;
      }
      if (trouble === 'crashed' && restarts < maxRestarts) {
        const crashed = listens;
        void exclusive(async () => {
          const now = recorder.state();
          if (now.status !== 'recording' || now.meetingId !== meetingId) {
            recorder.setProblem(meetingId, partLost(message));
            return;
          }
          if (listens !== crashed) {
            return;
          }
          restarts += 1;
          recorder.setProblem(
            meetingId,
            'Transcription restarted after an error, so a few seconds may be missing.',
          );
          const problem = listen(await speechSetup());
          if (problem !== null) {
            await halt(meetingId, problem);
          }
        }).catch(() => undefined);
        return;
      }
      void exclusive(() =>
        halt(
          meetingId,
          `Recording paused because transcription stopped: ${message}`,
        ),
      ).catch(() => undefined);
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function problemText(error: unknown): string {
  return `Recording paused because transcription couldn’t start: ${messageOf(error)}`;
}

function partLost(error: unknown): string {
  return `Part of the transcript couldn’t be made: ${messageOf(error)}`;
}
