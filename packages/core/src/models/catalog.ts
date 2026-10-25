export type ModelFile = {
  name: string;
  url: string;
  sizeBytes: number;
  sha256: string;
};

type ModelDetails = {
  id: string;
  name: string;
  description: string;
  languages: string;
  license: string;
  recommended: boolean;
  files: ModelFile[];
};

export type SpeechModel = ModelDetails & {
  kind: 'speech';
  engine: 'whisper' | 'parakeet';
};

export type SummaryModel = ModelDetails & {
  kind: 'summary';
  engine: 'llama';
};

export type ModelDefinition = SpeechModel | SummaryModel;

const whisperCpp =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1';
const parakeet =
  'https://huggingface.co/ggml-org/parakeet-GGUF/resolve/35156454d1a39de06863303dd209fd2bed6ee079';
const qwen =
  'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9';

export const vadFile: ModelFile = {
  name: 'ggml-silero-v6.2.0.bin',
  url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin',
  sizeBytes: 885_098,
  sha256: '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987',
};

export const modelCatalog: ModelDefinition[] = [
  {
    id: 'parakeet-tdt-0.6b-v3',
    kind: 'speech',
    engine: 'parakeet',
    name: 'Parakeet TDT 0.6B v3',
    description: 'Fast and accurate for European languages.',
    languages: '25 European languages',
    license: 'CC BY 4.0, NVIDIA (GGUF conversion)',
    recommended: true,
    files: [
      {
        name: 'ggml-parakeet-tdt-0.6b-v3-q8_0.bin',
        url: `${parakeet}/ggml-parakeet-tdt-0.6b-v3-q8_0.bin`,
        sizeBytes: 668_757_119,
        sha256:
          '4d64e9e96c2792186d072fde0034df0ad670cf680a2f53069052ead827fd600e',
      },
      vadFile,
    ],
  },
  {
    id: 'whisper-large-v3-turbo',
    kind: 'speech',
    engine: 'whisper',
    name: 'Whisper Large v3 Turbo',
    description: 'Most accurate, for any language. Slower on older computers.',
    languages: '99 languages',
    license: 'MIT, OpenAI',
    recommended: false,
    files: [
      {
        name: 'ggml-large-v3-turbo-q8_0.bin',
        url: `${whisperCpp}/ggml-large-v3-turbo-q8_0.bin`,
        sizeBytes: 874_188_075,
        sha256:
          '317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1',
      },
      vadFile,
    ],
  },
  {
    id: 'whisper-small',
    kind: 'speech',
    engine: 'whisper',
    name: 'Whisper Small',
    description: 'Small and quick, for any language. Less accurate.',
    languages: '99 languages',
    license: 'MIT, OpenAI',
    recommended: false,
    files: [
      {
        name: 'ggml-small-q8_0.bin',
        url: `${whisperCpp}/ggml-small-q8_0.bin`,
        sizeBytes: 264_464_607,
        sha256:
          '49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f',
      },
      vadFile,
    ],
  },
  {
    id: 'whisper-base',
    kind: 'speech',
    engine: 'whisper',
    name: 'Whisper Base',
    description: 'Small and quick, for older phones. Less accurate.',
    languages: '99 languages',
    license: 'MIT, OpenAI',
    recommended: false,
    files: [
      {
        name: 'ggml-base-q8_0.bin',
        url: `${whisperCpp}/ggml-base-q8_0.bin`,
        sizeBytes: 81_768_585,
        sha256:
          'c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9',
      },
      vadFile,
    ],
  },
  {
    id: 'qwen3-4b-instruct',
    kind: 'summary',
    engine: 'llama',
    name: 'Qwen3 4B Instruct',
    description: 'Writes meeting summaries on this device.',
    languages: '100+ languages',
    license: 'Apache 2.0, Qwen',
    recommended: true,
    files: [
      {
        name: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
        url: `${qwen}/Qwen3-4B-Instruct-2507-Q4_K_M.gguf`,
        sizeBytes: 2_497_281_120,
        sha256:
          '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597',
      },
    ],
  },
];

export function modelSize(model: Pick<ModelDefinition, 'files'>): number {
  return model.files.reduce((total, file) => total + file.sizeBytes, 0);
}

const phoneModelIds: readonly string[] = [
  'parakeet-tdt-0.6b-v3',
  'whisper-small',
  'whisper-base',
];

// A phone transcribes on its CPU (the GPU is off limits in the background),
// so it offers only the models that keep up there, the one it recommends
// first: Parakeet doesn't decode word by word as Whisper does, which makes the
// computer's accurate model fast enough; the small Whisper models cover the
// languages it lacks and phones short of memory.
export const phoneSpeechModels: SpeechModel[] = phoneModelIds.flatMap((id) =>
  modelCatalog.flatMap((model) =>
    model.kind === 'speech' && model.id === id ? [model] : [],
  ),
);
