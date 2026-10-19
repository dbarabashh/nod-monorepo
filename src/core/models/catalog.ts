export type ModelFile = {
  name: string;
  url: string;
  sizeBytes: number;
  sha256: string;
};

export type ModelRuntime = 'whisper.cpp' | 'sherpa-onnx';

export type ModelDefinition = {
  id: string;
  name: string;
  description: string;
  languages: string;
  license: string;
  runtime: ModelRuntime;
  recommended: boolean;
  files: ModelFile[];
};

const whisperCpp =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1';
const parakeet =
  'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/2bda32ec70b097a55adaa07d9a7173915b43cc78';

export const modelCatalog: ModelDefinition[] = [
  {
    id: 'parakeet-tdt-0.6b-v3',
    name: 'Parakeet TDT 0.6B v3',
    description: 'Fast and accurate for European languages.',
    languages: '25 European languages',
    license: 'CC BY 4.0, NVIDIA (int8 conversion)',
    runtime: 'sherpa-onnx',
    recommended: true,
    files: [
      {
        name: 'encoder.int8.onnx',
        url: `${parakeet}/encoder.int8.onnx`,
        sizeBytes: 652_184_281,
        sha256:
          'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247',
      },
      {
        name: 'decoder.int8.onnx',
        url: `${parakeet}/decoder.int8.onnx`,
        sizeBytes: 11_845_275,
        sha256:
          '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e',
      },
      {
        name: 'joiner.int8.onnx',
        url: `${parakeet}/joiner.int8.onnx`,
        sizeBytes: 6_355_277,
        sha256:
          '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3',
      },
      {
        name: 'tokens.txt',
        url: `${parakeet}/tokens.txt`,
        sizeBytes: 93_939,
        sha256:
          'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d',
      },
    ],
  },
  {
    id: 'whisper-large-v3-turbo',
    name: 'Whisper Large v3 Turbo',
    description: 'Most accurate, for any language. Slower on older computers.',
    languages: '99 languages',
    license: 'MIT, OpenAI',
    runtime: 'whisper.cpp',
    recommended: false,
    files: [
      {
        name: 'ggml-large-v3-turbo-q8_0.bin',
        url: `${whisperCpp}/ggml-large-v3-turbo-q8_0.bin`,
        sizeBytes: 874_188_075,
        sha256:
          '317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1',
      },
    ],
  },
  {
    id: 'whisper-small',
    name: 'Whisper Small',
    description: 'Small and quick, for any language. Less accurate.',
    languages: '99 languages',
    license: 'MIT, OpenAI',
    runtime: 'whisper.cpp',
    recommended: false,
    files: [
      {
        name: 'ggml-small-q8_0.bin',
        url: `${whisperCpp}/ggml-small-q8_0.bin`,
        sizeBytes: 264_464_607,
        sha256:
          '49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f',
      },
    ],
  },
];

export function modelSize(model: Pick<ModelDefinition, 'files'>): number {
  return model.files.reduce((total, file) => total + file.sizeBytes, 0);
}
