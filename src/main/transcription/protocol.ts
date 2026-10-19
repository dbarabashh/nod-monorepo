import type { Speaker, TranscriptLine } from '../../core/meetings/index.ts';
import type { SpeechModel } from '../../core/models/index.ts';

export type SpeechEngine = SpeechModel['engine'];

export type WorkerRequest =
  | {
      type: 'start';
      meetingId: string;
      offsetMs: number;
      engine: SpeechEngine;
      modelPath: string;
      vadPath: string;
    }
  | { type: 'audio'; speaker: Speaker; samples: Int16Array }
  | { type: 'flush'; requestId: number }
  | {
      type: 'summarize';
      requestId: number;
      modelPath: string;
      transcript: string;
    };

export type WorkerEvent =
  | { type: 'lines'; meetingId: string; lines: TranscriptLine[] }
  | { type: 'flushed'; requestId: number }
  | { type: 'summary'; requestId: number; text: string; title: string }
  | { type: 'failed'; requestId: number | null; message: string };

export { pcmSampleRate as sampleRate } from '../../shared/ipc.ts';
