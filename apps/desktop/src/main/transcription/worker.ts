import { randomUUID } from 'node:crypto';
import {
  loadModel,
  type CompletionResult,
  type LlamaCompletionOptions,
} from '@fugood/llama.node';
import {
  initParakeet,
  initWhisper,
  initWhisperVad,
  type ParakeetContext,
  type WhisperContext,
  type WhisperVadContext,
} from '@fugood/whisper.node';
import type { Speaker } from '@nod/core/meetings';
import {
  append,
  drainSpeech,
  emptyBuffer,
  type AudioBuffer,
} from '@nod/core/transcription';
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
  segment: number;
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
  const current = engine;
  const lines = await drainSpeech({
    buffer: stream.buffer,
    speaker: stream.speaker,
    final,
    newId: randomUUID,
    engine: current && {
      detectSpeech: async (audio) =>
        (await current.vad.detectSpeechData(audio.buffer)).map((segment) => ({
          startMs: segment.t0 * 10,
          endMs: segment.t1 * 10,
        })),
      transcribe: (pcm) => current.transcribe(pcm.buffer),
    },
  });
  if (lines.length > 0) {
    post({ type: 'lines', meetingId: stream.meetingId, lines });
  }
}

const summaryInstructions = [
  'You summarize meeting transcripts.',
  'Write the whole summary in the language most of the transcript is in, even when that is not English; only the two section headings stay as given.',
  'Start with two to four sentences that sum up the meeting, with no heading above them. Then add a "Key points" section (bullets) and an "Action items" section (bullets), each under a Markdown heading.',
  'Lines marked "Me" are the person who recorded the meeting; "Others" are everyone else. Speakers are not told apart beyond that, so a person exists only when the transcript says their name.',
  'An action item ends with "(Owner: <name>)" only when the transcript gives that person the task or they take it on, with their name as the transcript says it. It ends with "(Owner: Me)" only when a line marked "Me" takes the task on. Otherwise leave the owner out. Never guess an owner, and never give one to "Me" because "Me" recorded the meeting.',
  'Only use what the transcript says. If it is too short to summarize, say so in one sentence.',
].join(' ');

const titleInstructions = [
  'You name meetings from their summary.',
  'Reply with only a title of three to seven words, in the language of the summary, naming what the meeting was mainly about.',
  'No quotes, no label, no full stop at the end.',
].join(' ');

const titleReplyTokens = 32;

// Some models reason before they answer unless told not to, which is slower
// and could leave the reasoning in the summary.
const answerOnly = {
  enable_thinking: false,
  reasoning_format: 'auto',
} satisfies Pick<
  LlamaCompletionOptions,
  'enable_thinking' | 'reasoning_format'
>;

// A reply that went into reasoning has no answer; its raw text would put the
// reasoning in the note.
function answer(result: CompletionResult): string {
  return (
    result.reasoning_content
      ? (result.content ?? '')
      : (result.content ?? result.text)
  ).trim();
}

async function summarize(
  modelPath: string,
  contextTokens: number,
  transcript: string,
): Promise<{ summary: string; title: string }> {
  const llama = await loadModel({
    model: modelPath,
    n_ctx: contextTokens,
    n_gpu_layers: 99,
  });
  try {
    const budget = contextTokens - summaryReplyTokens - summaryPromptTokens;
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
      ...answerOnly,
    });
    const summary = answer(result);
    if (!summary) {
      throw new Error('No summary');
    }
    // The model is already loaded and the summary is far shorter than the
    // transcript, so naming the meeting costs little; if naming fails, the
    // summary is kept and the meeting keeps its name.
    const title = await llama
      .completion({
        messages: [
          { role: 'system', content: titleInstructions },
          { role: 'user', content: summary },
        ],
        n_predict: titleReplyTokens,
        temperature: 0.2,
        ...answerOnly,
      })
      .then(
        (named) => answer(named),
        () => '',
      );
    return { summary, title };
  } finally {
    await llama.release();
  }
}

const unloadable =
  'If this keeps happening, delete it in Settings → Transcription and download it again.';

function failure(requestId: number, error: unknown): WorkerEvent {
  return { type: 'failed', requestId, message: messageOf(error) };
}

function trouble(
  stream: Pick<Stream, 'meetingId' | 'segment'>,
  kind: 'part-lost' | 'unloadable',
  message: string,
): WorkerEvent {
  return {
    type: 'trouble',
    meetingId: stream.meetingId,
    segment: stream.segment,
    kind,
    message,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function handle(request: WorkerRequest) {
  switch (request.type) {
    case 'start': {
      streams = new Map(
        speakers.map((speaker) => [
          speaker,
          {
            meetingId: request.meetingId,
            segment: request.segment,
            speaker,
            buffer: emptyBuffer(request.offsetMs),
            unprocessedMs: 0,
          },
        ]),
      );
      void transcription(() =>
        loadEngine(request.engine, request.modelPath, request.vadPath),
      ).catch((error: unknown) =>
        post(
          trouble(
            request,
            'unloadable',
            `The speech model couldn’t be loaded (${messageOf(error)}). ${unloadable}`,
          ),
        ),
      );
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
          post(trouble(stream, 'part-lost', messageOf(error))),
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
        summarize(request.modelPath, request.contextTokens, request.transcript),
      ).then(
        ({ summary, title }) =>
          post({
            type: 'summary',
            requestId: request.requestId,
            text: summary,
            title,
          }),
        (error: unknown) => post(failure(request.requestId, error)),
      );
      break;
  }
}

process.parentPort.on('message', (event) => handle(event.data));
