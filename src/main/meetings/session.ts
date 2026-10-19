import { transcriptText } from '../../core/meetings/index.ts';
import { vadFile } from '../../core/models/index.ts';
import type { ModelManager } from '../models/manager.ts';
import type { Transcriber } from '../transcription/service.ts';
import type { Recorder } from './recorder.ts';

// Keeps the prompt inside the summary model's context window.
const maxTranscriptChars = 40_000;

export type MeetingSession = {
  start: (title: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  pause: () => Promise<void>;
  finish: (id: string) => Promise<void>;
};

export function createMeetingSession(options: {
  recorder: Recorder;
  models: ModelManager;
  transcriber: Transcriber;
}): MeetingSession {
  const { recorder, models, transcriber } = options;

  async function listen() {
    const state = recorder.state();
    const speech = await models.installed('speech');
    const model = speech?.model;
    const weights = model?.files.find((file) => file.name !== vadFile.name);
    if (
      state.status !== 'recording' ||
      !speech ||
      model?.kind !== 'speech' ||
      !weights
    ) {
      return;
    }
    transcriber.start(state.meetingId, state.previousMs, {
      engine: model.engine,
      modelPath: speech.path(weights.name),
      vadPath: speech.path(vadFile.name),
    });
  }

  async function pause() {
    await recorder.pause();
    await transcriber.flush();
  }

  async function summarize(id: string) {
    const meeting = recorder.transcriptOf(id);
    const summaryModel = await models.installed('summary');
    const weights = summaryModel?.model.files[0];
    if (
      !meeting ||
      meeting.transcript.length === 0 ||
      !summaryModel ||
      !weights
    ) {
      return;
    }
    recorder.setSummarizing(id, true);
    try {
      const text = transcriptText(meeting).slice(-maxTranscriptChars);
      await recorder.saveSummary(
        id,
        await transcriber.summarize(summaryModel.path(weights.name), text),
      );
    } finally {
      recorder.setSummarizing(id, false);
    }
  }

  return {
    start: async (title) => {
      await recorder.start(title);
      await listen();
    },
    resume: async (id) => {
      await recorder.resume(id);
      await listen();
    },
    pause,
    finish: async (id) => {
      if (recorder.state().status === 'recording') {
        await pause();
      }
      await recorder.finish(id);
      void summarize(id).catch(() => undefined);
    },
  };
}
