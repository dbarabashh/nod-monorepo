import { utilityProcess, type UtilityProcess } from 'electron';
import type { Speaker, TranscriptLine } from '../../core/meetings/index.ts';
import {
  sampleRate,
  type SpeechEngine,
  type WorkerEvent,
  type WorkerRequest,
} from './protocol.ts';

const maxEarlySamples = 10 * sampleRate;

export type SpeechSetup = {
  engine: SpeechEngine;
  modelPath: string;
  vadPath: string;
};

export type Transcriber = {
  start: (meetingId: string, offsetMs: number, setup: SpeechSetup) => void;
  audio: (speaker: Speaker, samples: Int16Array) => void;
  flush: () => Promise<void>;
  summarize: (modelPath: string, transcript: string) => Promise<string>;
};

type Pending = {
  resolve: (event: WorkerEvent) => void;
  reject: (error: Error) => void;
};

export function createTranscriber(options: {
  workerPath: string;
  onLines: (meetingId: string, lines: TranscriptLine[]) => void;
  onFailure: (message: string, stopped: boolean) => void;
}): Transcriber {
  const { workerPath, onLines, onFailure } = options;
  let worker: UtilityProcess | null = null;
  let listening = false;
  let early: Array<{ speaker: Speaker; samples: Int16Array }> = [];
  let earlySamples = 0;
  let nextRequest = 1;
  const pending = new Map<number, Pending>();

  function spawn(): UtilityProcess {
    if (worker) {
      return worker;
    }
    const child = utilityProcess.fork(workerPath, [], {
      serviceName: 'Transcription',
    });
    child.on('message', (event: WorkerEvent) => {
      if (event.type === 'lines') {
        onLines(event.meetingId, event.lines);
        return;
      }
      if (event.requestId === null) {
        if (event.type === 'failed' && listening) {
          onFailure(event.message, false);
        }
        return;
      }
      pending.get(event.requestId)?.resolve(event);
      pending.delete(event.requestId);
    });
    child.on('exit', () => {
      worker = null;
      for (const request of pending.values()) {
        request.reject(new Error('Transcription stopped unexpectedly'));
      }
      pending.clear();
      if (listening) {
        listening = false;
        onFailure('Transcription stopped unexpectedly', true);
      }
    });
    worker = child;
    return child;
  }

  function ask(
    build: (requestId: number) => WorkerRequest,
  ): Promise<WorkerEvent> {
    const requestId = nextRequest++;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      spawn().postMessage(build(requestId));
    });
  }

  function forgetEarly() {
    early = [];
    earlySamples = 0;
  }

  return {
    start: (meetingId, offsetMs, setup) => {
      const child = spawn();
      child.postMessage({ type: 'start', meetingId, offsetMs, ...setup });
      for (const { speaker, samples } of early) {
        child.postMessage({ type: 'audio', speaker, samples });
      }
      forgetEarly();
      listening = true;
    },
    // Audio that arrives while the model is being picked is kept for a few
    // seconds, so the first words of a meeting aren't lost.
    audio: (speaker, samples) => {
      if (listening && worker) {
        worker.postMessage({ type: 'audio', speaker, samples });
      } else if (earlySamples + samples.length <= maxEarlySamples) {
        early.push({ speaker, samples });
        earlySamples += samples.length;
      }
    },
    flush: async () => {
      forgetEarly();
      if (!listening || !worker) {
        return;
      }
      listening = false;
      const event = await ask((requestId) => ({ type: 'flush', requestId }));
      if (event.type === 'failed') {
        throw new Error(event.message);
      }
    },
    summarize: async (modelPath, transcript) => {
      const event = await ask((requestId) => ({
        type: 'summarize',
        requestId,
        modelPath,
        transcript,
      }));
      if (event.type !== 'summary') {
        throw new Error(event.type === 'failed' ? event.message : 'No summary');
      }
      return event.text;
    },
  };
}
