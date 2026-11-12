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
  contextTokens: number;
  minMemoryBytes: number;
};

export type ModelDefinition = SpeechModel | SummaryModel;

const whisperCpp =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1';
const parakeet =
  'https://huggingface.co/ggml-org/parakeet-GGUF/resolve/35156454d1a39de06863303dd209fd2bed6ee079';
const qwen =
  'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9';
const qwen35Small =
  'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae';
const qwen35 =
  'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/e87f176479d0855a907a41277aca2f8ee7a09523';
const gemma4 =
  'https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-gguf/resolve/29d097773436b69ff9feafd636ab4cf873786537';
const gemma4Moe =
  'https://huggingface.co/google/gemma-4-26B-A4B-it-qat-q4_0-gguf/resolve/d1c082be9cf3c8a514acf63b8761f4b41935842e';
const gemma4E2b =
  'https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/resolve/675cff42a74c774d6cb76f76d8eacb49b48c9b93';
const gemma4E4b =
  'https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/4b4a2c1d584be7264f87aac328a1bc739ce81b6c';
const gemma4Dense =
  'https://huggingface.co/google/gemma-4-31B-it-qat-q4_0-gguf/resolve/59dde24573e7e61570dba08b18a2e1fe246955ed';
const qwen35Medium =
  'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/3885219b6810b007914f3a7950a8d1b469d598a5';
const qwen36Moe =
  'https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/resolve/a483e9e6cbd595906af30beda3187c2663a1118c';

const gigabyte = 1024 ** 3;

// Qwen3.5, Qwen3.6 and Gemma 4 keep full attention in few layers, so a context
// that holds a two-hour meeting costs less memory than Qwen3 4B's 16k.
const longMeetingTokens = 65_536;

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
    // CC BY asks for the changes to be named: these are NVIDIA's weights,
    // converted and quantized by ggml-org.
    license: 'CC BY 4.0, NVIDIA; converted to GGUF and quantized by ggml-org',
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
    id: 'parakeet-tdt-0.6b-v3-q4',
    kind: 'speech',
    engine: 'parakeet',
    name: 'Parakeet TDT 0.6B v3 Small',
    description:
      'A smaller download of the same model, for phones and older computers. Slightly less accurate.',
    languages: '25 European languages',
    license: 'CC BY 4.0, NVIDIA; converted to GGUF and quantized by ggml-org',
    recommended: false,
    files: [
      {
        name: 'ggml-parakeet-tdt-0.6b-v3-q4_k.bin',
        url: `${parakeet}/ggml-parakeet-tdt-0.6b-v3-q4_k.bin`,
        sizeBytes: 415_611_879,
        sha256:
          '8b205b8b39c6535e153de6fb11c51db46125d45c4f16ba496fe41a0fe71b885e',
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
    id: 'qwen3.5-2b',
    kind: 'summary',
    engine: 'llama',
    name: 'Qwen3.5 2B',
    description:
      'Small and quick, for older computers. Best in English: summaries of other languages may come out in English.',
    languages: '200+ languages',
    license: 'Apache 2.0, Qwen',
    recommended: false,
    contextTokens: longMeetingTokens,
    minMemoryBytes: 8 * gigabyte,
    files: [
      {
        name: 'Qwen3.5-2B-Q4_K_M.gguf',
        url: `${qwen35Small}/Qwen3.5-2B-Q4_K_M.gguf`,
        sizeBytes: 1_280_835_840,
        sha256:
          'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223',
      },
    ],
  },
  {
    id: 'gemma-4-e2b',
    kind: 'summary',
    engine: 'llama',
    name: 'Gemma 4 E2B',
    description:
      'Small, for older computers, and better than Qwen3.5 2B at meetings not in English.',
    languages: '140+ languages',
    license: 'Apache 2.0, Google',
    recommended: false,
    contextTokens: longMeetingTokens,
    minMemoryBytes: 8 * gigabyte,
    files: [
      {
        name: 'gemma-4-E2B_q4_0-it.gguf',
        url: `${gemma4E2b}/gemma-4-E2B_q4_0-it.gguf`,
        sizeBytes: 3_349_516_256,
        sha256:
          'fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634',
      },
    ],
  },
  {
    id: 'qwen3-4b-instruct',
    kind: 'summary',
    engine: 'llama',
    name: 'Qwen3 4B Instruct',
    description:
      'The previous default. Summarizes only the last part of a long meeting.',
    languages: '100+ languages',
    license: 'Apache 2.0, Qwen',
    recommended: false,
    // Every layer attends to the whole context, so its cache grows fast.
    contextTokens: 16_384,
    minMemoryBytes: 8 * gigabyte,
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
  {
    id: 'qwen3.5-4b',
    kind: 'summary',
    engine: 'llama',
    name: 'Qwen3.5 4B',
    description:
      'Balanced quality and speed, for computers with 8 GB of memory. Reads a two-hour meeting whole.',
    languages: '200+ languages',
    license: 'Apache 2.0, Qwen',
    recommended: true,
    contextTokens: longMeetingTokens,
    minMemoryBytes: 8 * gigabyte,
    files: [
      {
        name: 'Qwen3.5-4B-Q4_K_M.gguf',
        url: `${qwen35}/Qwen3.5-4B-Q4_K_M.gguf`,
        sizeBytes: 2_740_937_888,
        sha256:
          '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
      },
    ],
  },
  {
    id: 'gemma-4-e4b',
    kind: 'summary',
    engine: 'llama',
    name: 'Gemma 4 E4B',
    description:
      'Strong at meetings not in English, for computers with 12 GB of memory or more.',
    languages: '140+ languages',
    license: 'Apache 2.0, Google',
    recommended: false,
    contextTokens: longMeetingTokens,
    minMemoryBytes: 12 * gigabyte,
    files: [
      {
        name: 'gemma-4-E4B_q4_0-it.gguf',
        url: `${gemma4E4b}/gemma-4-E4B_q4_0-it.gguf`,
        sizeBytes: 5_154_941_280,
        sha256:
          '676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee',
      },
    ],
  },
  {
    id: 'qwen3.5-9b',
    kind: 'summary',
    engine: 'llama',
    name: 'Qwen3.5 9B',
    description:
      'Better summaries of long meetings, for computers with 16 GB of memory or more.',
    languages: '200+ languages',
    license: 'Apache 2.0, Qwen',
    recommended: false,
    contextTokens: longMeetingTokens,
    minMemoryBytes: 16 * gigabyte,
    files: [
      {
        name: 'Qwen3.5-9B-Q4_K_M.gguf',
        url: `${qwen35Medium}/Qwen3.5-9B-Q4_K_M.gguf`,
        sizeBytes: 5_680_522_464,
        sha256:
          '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8',
      },
    ],
  },
  {
    id: 'gemma-4-12b',
    kind: 'summary',
    engine: 'llama',
    name: 'Gemma 4 12B',
    description:
      'Better summaries, for computers with 16 GB of memory or more.',
    languages: '140+ languages',
    license: 'Apache 2.0, Google',
    recommended: false,
    contextTokens: longMeetingTokens,
    minMemoryBytes: 16 * gigabyte,
    files: [
      {
        name: 'gemma-4-12b-it-qat-q4_0.gguf',
        url: `${gemma4}/gemma-4-12b-it-qat-q4_0.gguf`,
        sizeBytes: 6_975_879_296,
        sha256:
          '93567e57a8fe10b23569b9d9ec38cd005deedf71e29477c421a4b83f418a538b',
      },
    ],
  },
  {
    id: 'gemma-4-26b-a4b',
    kind: 'summary',
    engine: 'llama',
    name: 'Gemma 4 26B',
    description: 'Best summaries, for computers with 24 GB of memory or more.',
    languages: '140+ languages',
    license: 'Apache 2.0, Google',
    recommended: false,
    contextTokens: longMeetingTokens,
    minMemoryBytes: 24 * gigabyte,
    files: [
      {
        name: 'gemma-4-26B_q4_0-it.gguf',
        url: `${gemma4Moe}/gemma-4-26B_q4_0-it.gguf`,
        sizeBytes: 14_439_363_584,
        sha256:
          '3eca3b8f6d7baf218a7dd6bba5fb59a56ee25fe2d567b6f5f589b4f697eca51d',
      },
    ],
  },
  {
    id: 'qwen3.6-35b-a3b',
    kind: 'summary',
    engine: 'llama',
    name: 'Qwen3.6 35B',
    description:
      'Top quality and still quick, for computers with 32 GB of memory or more.',
    languages: '200+ languages',
    license: 'Apache 2.0, Qwen',
    recommended: false,
    contextTokens: longMeetingTokens,
    minMemoryBytes: 32 * gigabyte,
    files: [
      {
        name: 'Qwen3.6-35B-A3B-UD-Q4_K_M.gguf',
        url: `${qwen36Moe}/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf`,
        sizeBytes: 22_134_528_992,
        sha256:
          'ac0e2c1189e055faa36eff361580e79c5bd6f8e76bffb4ce547f167d53e31a61',
      },
    ],
  },
  {
    id: 'gemma-4-31b',
    kind: 'summary',
    engine: 'llama',
    name: 'Gemma 4 31B',
    description:
      'Top quality, best at meetings not in English. Slower; for computers with 32 GB of memory or more.',
    languages: '140+ languages',
    license: 'Apache 2.0, Google',
    recommended: false,
    contextTokens: longMeetingTokens,
    minMemoryBytes: 32 * gigabyte,
    files: [
      {
        name: 'gemma-4-31B_q4_0-it.gguf',
        url: `${gemma4Dense}/gemma-4-31B_q4_0-it.gguf`,
        sizeBytes: 17_651_001_568,
        sha256:
          '179cfb99212709597eae5929112cfca677e1bbf566178b479ae1da0c4772874b',
      },
    ],
  },
];

export function modelSize(model: Pick<ModelDefinition, 'files'>): number {
  return model.files.reduce((total, file) => total + file.sizeBytes, 0);
}

const phoneModelIds: readonly string[] = [
  'parakeet-tdt-0.6b-v3',
  'parakeet-tdt-0.6b-v3-q4',
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
