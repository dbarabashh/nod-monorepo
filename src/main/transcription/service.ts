import { utilityProcess, type UtilityProcess } from 'electron';
import type { Speaker, TranscriptLine } from '../../core/meetings/index.ts';
import type { SpeechEngine, WorkerEvent, WorkerRequest } from './protocol.ts';

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
}): Transcriber {
  const { workerPath, onLines } = options;
  let worker: UtilityProcess | null = null;
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
    });
    worker = child;
    return child;
  }

  function send(request: WorkerRequest) {
    spawn().postMessage(request);
  }

  function ask(
    build: (requestId: number) => WorkerRequest,
  ): Promise<WorkerEvent> {
    const requestId = nextRequest++;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      send(build(requestId));
    });
  }

  return {
    start: (meetingId, offsetMs, setup) =>
      send({ type: 'start', meetingId, offsetMs, ...setup }),
    audio: (speaker, samples) => {
      if (worker) {
        worker.postMessage({ type: 'audio', speaker, samples });
      }
    },
    flush: async () => {
      if (!worker) {
        return;
      }
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
