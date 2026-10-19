import { randomUUID } from 'node:crypto';
import { loadModel } from '@fugood/llama.node';
import {
  initParakeet,
  initWhisper,
  initWhisperVad,
  type ParakeetContext,
  type WhisperContext,
  type WhisperVadContext,
} from '@fugood/whisper.node';
import type { Speaker, TranscriptLine } from '../../core/meetings/index.ts';
import {
  append,
  consume,
  emptyBuffer,
  snapshot,
  type AudioBuffer,
} from './audio-buffer.ts';
import { planChunks } from '../../core/transcription/index.ts';
import { ignoreClosedOutput } from '../closed-output.ts';
import {
  sampleRate,
  type SpeechEngine,
  type WorkerEvent,
  type WorkerRequest,
} from './protocol.ts';

ignoreClosedOutput();

const samplesPerMs = sampleRate / 1000;
const processEveryMs = 2_000;
const summaryContextTokens = 16_384;
const summaryReplyTokens = 1_024;
const summaryPromptTokens = 512;

type Engine = {
  key: string;
  vad: WhisperVadContext;
  transcribe: (pcm: ArrayBuffer) => Promise<string>;
  release: () => Promise<void>;
};

type Stream = {
  meetingId: string;
  speaker: Speaker;
  buffer: AudioBuffer;
  unprocessedMs: number;
};

let engine: Engine | null = null;
let streams = new Map<Speaker, Stream>();
const speakers: Speaker[] = ['me', 'others'];

function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const result = tail.then(job);
    tail = result.catch(() => undefined);
    return result;
  };
}

// Summaries share the queue with transcription: a summary model loaded next
// to a live meeting's speech model can run out of memory or fall behind.
const transcription = serial();

function post(event: WorkerEvent) {
  process.parentPort.postMessage(event);
}

async function loadEngine(
  kind: SpeechEngine,
  modelPath: string,
  vadPath: string,
): Promise<void> {
  const key = `${kind}:${modelPath}`;
  if (engine?.key === key) {
    return;
  }
  await releaseEngine();
  // Silero is tiny and its GPU path crashes on Metal; the CPU is fast enough.
  const vad = await initWhisperVad({
    filePath: vadPath,
    useGpu: false,
    nThreads: 2,
  });
  let model: WhisperContext | ParakeetContext;
  let transcribe: Engine['transcribe'];
  try {
    if (kind === 'whisper') {
      const whisper = await initWhisper({ filePath: modelPath, useGpu: true });
      model = whisper;
      transcribe = async (pcm) =>
        (await whisper.transcribeData(pcm, { language: 'auto' }).promise)
          .result;
    } else {
      const parakeet = await initParakeet({
        filePath: modelPath,
        useGpu: true,
      });
      model = parakeet;
      transcribe = async (pcm) =>
        (await parakeet.transcribeData(pcm).promise).result;
    }
  } catch (error) {
    await vad.release();
    throw error;
  }
  engine = {
    key,
    vad,
    transcribe,
    release: async () => {
      await model.release();
      await vad.release();
    },
  };
}

async function releaseEngine(): Promise<void> {
  const current = engine;
  engine = null;
  await current?.release();
}

async function drain(stream: Stream, final: boolean): Promise<void> {
  if (stream.buffer.samples === 0) {
    return;
  }
  const taken = snapshot(stream.buffer);
  const { audio } = taken;
  const bufferMs = audio.length / samplesPerMs;
  // Audio no engine could hear is dropped, so a failed model can't hold
  // the whole meeting in memory.
  if (!engine) {
    consume(stream.buffer, taken, bufferMs, samplesPerMs);
    return;
  }
  try {
    const speech = (await engine.vad.detectSpeechData(audio.buffer)).map(
      (segment) => ({ startMs: segment.t0 * 10, endMs: segment.t1 * 10 }),
    );
    const plan = planChunks(speech, bufferMs, final);
    const baseMs = stream.buffer.baseMs;
    const lines: TranscriptLine[] = [];
    for (const chunk of plan.chunks) {
      const pcm = audio.slice(
        Math.floor(chunk.startMs * samplesPerMs),
        Math.ceil(chunk.endMs * samplesPerMs),
      );
      lines.push({
        id: randomUUID(),
        speaker: stream.speaker,
        startMs: Math.round(baseMs + chunk.startMs),
        endMs: Math.round(baseMs + chunk.endMs),
        text: await engine.transcribe(pcm.buffer),
      });
    }
    consume(stream.buffer, taken, plan.consumeMs, samplesPerMs);
    if (lines.length > 0) {
      post({ type: 'lines', meetingId: stream.meetingId, lines });
    }
  } catch (error) {
    consume(stream.buffer, taken, bufferMs, samplesPerMs);
    throw error;
  }
}

const summaryInstructions = [
  'You summarize meeting transcripts.',
  'Write in the language most of the transcript is in.',
  'Start with two to four sentences that sum up the meeting, with no heading above them. Then add a "Key points" section (bullets) and an "Action items" section (bullets, with the owner when the transcript names one), each under a Markdown heading.',
  'Lines marked "Me" are the person who recorded the meeting; "Others" are everyone else.',
  'Only use what the transcript says. If it is too short to summarize, say so in one sentence.',
].join(' ');

async function summarize(
  modelPath: string,
  transcript: string,
): Promise<string> {
  const llama = await loadModel({
    model: modelPath,
    n_ctx: summaryContextTokens,
    n_gpu_layers: 99,
  });
  try {
    const budget =
      summaryContextTokens - summaryReplyTokens - summaryPromptTokens;
    const { tokens } = await llama.tokenize(transcript);
    const fitted =
      tokens.length > budget
        ? await llama.detokenize(Array.from(tokens.subarray(-budget)))
        : transcript;
    const result = await llama.completion({
      messages: [
        { role: 'system', content: summaryInstructions },
        { role: 'user', content: fitted },
      ],
      n_predict: summaryReplyTokens,
      temperature: 0.3,
    });
    return (result.content ?? result.text).trim();
  } finally {
    await llama.release();
  }
}

function failure(requestId: number | null, error: unknown): WorkerEvent {
  return {
    type: 'failed',
    requestId,
    message: error instanceof Error ? error.message : String(error),
  };
}

function handle(request: WorkerRequest) {
  switch (request.type) {
    case 'start': {
      streams = new Map(
        speakers.map((speaker) => [
          speaker,
          {
            meetingId: request.meetingId,
            speaker,
            buffer: emptyBuffer(request.offsetMs),
            unprocessedMs: 0,
          },
        ]),
      );
      void transcription(() =>
        loadEngine(request.engine, request.modelPath, request.vadPath),
      ).catch((error: unknown) => post(failure(null, error)));
      break;
    }
    case 'audio': {
      const stream = streams.get(request.speaker);
      if (!stream) {
        return;
      }
      append(stream.buffer, request.samples);
      stream.unprocessedMs += request.samples.length / samplesPerMs;
      if (stream.unprocessedMs >= processEveryMs) {
        stream.unprocessedMs = 0;
        void transcription(() => drain(stream, false)).catch((error: unknown) =>
          post(failure(null, error)),
        );
      }
      break;
    }
    case 'flush': {
      const current = [...streams.values()];
      streams = new Map();
      void transcription(async () => {
        const errors: unknown[] = [];
        for (const stream of current) {
          await drain(stream, true).catch((error: unknown) => {
            errors.push(error);
          });
        }
        await releaseEngine();
        if (errors.length > 0) {
          throw errors[0];
        }
      }).then(
        () => post({ type: 'flushed', requestId: request.requestId }),
        (error: unknown) => post(failure(request.requestId, error)),
      );
      break;
    }
    case 'summarize':
      void transcription(() =>
        summarize(request.modelPath, request.transcript),
      ).then(
        (text) => post({ type: 'summary', requestId: request.requestId, text }),
        (error: unknown) => post(failure(request.requestId, error)),
      );
      break;
  }
}

process.parentPort.on('message', (event) => handle(event.data));
