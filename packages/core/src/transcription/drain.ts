import type { Speaker, TranscriptLine } from '../meetings/index.ts';
import { consume, snapshot, type AudioBuffer } from './audio-buffer.ts';
import {
  defaultChunkOptions,
  planChunks,
  type ChunkOptions,
  type Span,
} from './chunks.ts';

export const sampleRate = 16_000;
const samplesPerMs = sampleRate / 1000;

// What a platform's speech engine does for a stream of 16 kHz mono PCM.
export type SpeechEngine = {
  detectSpeech: (audio: Int16Array<ArrayBuffer>) => Promise<Span[]>;
  transcribe: (pcm: Int16Array<ArrayBuffer>) => Promise<string>;
};

// Transcribes the speech in a stream's buffer that has settled, and keeps
// the rest for later. With `final`, everything left is transcribed. Audio no
// engine could hear is dropped, so a failed model can't hold the whole
// meeting in memory; audio a failing engine choked on is dropped too.
// `onLine` gets each line as soon as it is transcribed, so a long final
// drain that is cut short keeps what it had done.
export async function drainSpeech(options: {
  buffer: AudioBuffer;
  speaker: Speaker;
  engine: SpeechEngine | null;
  final: boolean;
  newId: () => string;
  chunks?: ChunkOptions;
  onLine?: (line: TranscriptLine) => Promise<void>;
}): Promise<TranscriptLine[]> {
  const { buffer, speaker, engine, final, newId } = options;
  if (buffer.samples === 0) {
    return [];
  }
  const taken = snapshot(buffer);
  const { audio } = taken;
  const bufferMs = audio.length / samplesPerMs;
  if (!engine) {
    consume(buffer, taken, bufferMs, samplesPerMs);
    return [];
  }
  try {
    const speech = await engine.detectSpeech(audio);
    const plan = planChunks(
      speech,
      bufferMs,
      final,
      options.chunks ?? defaultChunkOptions,
    );
    const baseMs = buffer.baseMs;
    const lines: TranscriptLine[] = [];
    for (const chunk of plan.chunks) {
      const text = await engine.transcribe(
        audio.slice(
          Math.floor(chunk.startMs * samplesPerMs),
          Math.ceil(chunk.endMs * samplesPerMs),
        ),
      );
      const line: TranscriptLine = {
        id: newId(),
        speaker,
        startMs: Math.round(baseMs + chunk.startMs),
        endMs: Math.round(baseMs + chunk.endMs),
        text,
      };
      lines.push(line);
      await options.onLine?.(line);
    }
    consume(buffer, taken, plan.consumeMs, samplesPerMs);
    return lines;
  } catch (error) {
    consume(buffer, taken, bufferMs, samplesPerMs);
    throw error;
  }
}
