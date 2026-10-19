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
import { planChunks } from '../../core/transcription/index.ts';
import {
  sampleRate,
  type SpeechEngine,
  type WorkerEvent,
  type WorkerRequest,
} from './protocol.ts';

const samplesPerMs = sampleRate / 1000;
const processEveryMs = 2_000;

type Engine = {
  key: string;
  vad: WhisperVadContext;
  transcribe: (pcm: ArrayBuffer) => Promise<string>;
  release: () => Promise<void>;
};

type Stream = {
  pending: Int16Array[];
  pendingSamples: number;
  baseMs: number;
  unprocessedMs: number;
};

let engine: Engine | null = null;
let meetingId = '';
const streams = new Map<Speaker, Stream>();
let queue: Promise<unknown> = Promise.resolve();
const speakers: Speaker[] = ['me', 'others'];

function post(event: WorkerEvent) {
  process.parentPort.postMessage(event);
}

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const result = queue.then(job);
  queue = result.catch(() => undefined);
  return result;
}

async function loadEngine(
  kind: SpeechEngine,
  modelPath: string,
  vadPath: string,
): Promise<Engine> {
  const key = `${kind}:${modelPath}`;
  if (engine?.key === key) {
    return engine;
  }
  await engine?.release();
  engine = null;
  // Silero is tiny and its GPU path crashes on Metal; the CPU is fast enough.
  const vad = await initWhisperVad({
    filePath: vadPath,
    useGpu: false,
    nThreads: 2,
  });
  let model: WhisperContext | ParakeetContext;
  let transcribe: Engine['transcribe'];
  if (kind === 'whisper') {
    const whisper = await initWhisper({ filePath: modelPath, useGpu: true });
    model = whisper;
    transcribe = async (pcm) =>
      (await whisper.transcribeData(pcm, { language: 'auto' }).promise).result;
  } else {
    const parakeet = await initParakeet({ filePath: modelPath, useGpu: true });
    model = parakeet;
    transcribe = async (pcm) =>
      (await parakeet.transcribeData(pcm).promise).result;
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
  return engine;
}

function joined(stream: Stream): Int16Array<ArrayBuffer> {
  const all = new Int16Array(new ArrayBuffer(stream.pendingSamples * 2));
  let offset = 0;
  for (const part of stream.pending) {
    all.set(part, offset);
    offset += part.length;
  }
  return all;
}

function toArrayBuffer(samples: Int16Array): ArrayBuffer {
  return samples.slice().buffer;
}

async function drain(speaker: Speaker, final: boolean): Promise<void> {
  const stream = streams.get(speaker);
  if (!engine || !stream || stream.pendingSamples === 0) {
    return;
  }
  const audio = joined(stream);
  const bufferMs = audio.length / samplesPerMs;
  const speech = (await engine.vad.detectSpeechData(audio.buffer)).map(
    (segment) => ({ startMs: segment.t0 * 10, endMs: segment.t1 * 10 }),
  );
  const plan = planChunks(speech, bufferMs, final);
  const lines: TranscriptLine[] = [];
  for (const chunk of plan.chunks) {
    const pcm = audio.subarray(
      Math.floor(chunk.startMs * samplesPerMs),
      Math.ceil(chunk.endMs * samplesPerMs),
    );
    const text = await engine.transcribe(toArrayBuffer(pcm));
    lines.push({
      speaker,
      startMs: Math.round(stream.baseMs + chunk.startMs),
      endMs: Math.round(stream.baseMs + chunk.endMs),
      text,
    });
  }
  const rest = audio.subarray(Math.floor(plan.consumeMs * samplesPerMs));
  stream.pending = rest.length > 0 ? [rest.slice()] : [];
  stream.pendingSamples = rest.length;
  stream.baseMs += plan.consumeMs;
  if (lines.length > 0) {
    post({ type: 'lines', meetingId, lines });
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
    n_ctx: 16_384,
    n_gpu_layers: 99,
  });
  try {
    const result = await llama.completion({
      messages: [
        { role: 'system', content: summaryInstructions },
        { role: 'user', content: transcript },
      ],
      n_predict: 1_024,
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
    case 'start':
      void enqueue(async () => {
        meetingId = request.meetingId;
        streams.clear();
        for (const speaker of speakers) {
          streams.set(speaker, {
            pending: [],
            pendingSamples: 0,
            baseMs: request.offsetMs,
            unprocessedMs: 0,
          });
        }
        await loadEngine(request.engine, request.modelPath, request.vadPath);
      }).catch((error: unknown) => post(failure(null, error)));
      break;
    case 'audio': {
      const stream = streams.get(request.speaker);
      if (!stream) {
        return;
      }
      stream.pending.push(request.samples);
      stream.pendingSamples += request.samples.length;
      stream.unprocessedMs += request.samples.length / samplesPerMs;
      if (stream.unprocessedMs >= processEveryMs) {
        stream.unprocessedMs = 0;
        void enqueue(() => drain(request.speaker, false)).catch(
          (error: unknown) => post(failure(null, error)),
        );
      }
      break;
    }
    case 'flush':
      void enqueue(async () => {
        for (const speaker of speakers) {
          await drain(speaker, true);
        }
      }).then(
        () => post({ type: 'flushed', requestId: request.requestId }),
        (error: unknown) => post(failure(request.requestId, error)),
      );
      break;
    case 'summarize':
      void enqueue(() => summarize(request.modelPath, request.transcript)).then(
        (text) => post({ type: 'summary', requestId: request.requestId, text }),
        (error: unknown) => post(failure(request.requestId, error)),
      );
      break;
  }
}

process.parentPort.on('message', (event) => handle(event.data));
