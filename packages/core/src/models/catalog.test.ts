import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { modelCatalog, modelSize, phoneSpeechModels } from './catalog.ts';

describe('modelCatalog', () => {
  it('pins every file to an exact Hugging Face revision over https', () => {
    for (const model of modelCatalog) {
      for (const file of model.files) {
        assert.match(
          file.url,
          /^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\/[^/]+$/,
          file.url,
        );
        assert.ok(file.url.endsWith(`/${file.name}`), file.url);
      }
    }
  });

  it('gives every file a sha256 and a size to verify the download against', () => {
    for (const model of modelCatalog) {
      for (const file of model.files) {
        assert.match(file.sha256, /^[0-9a-f]{64}$/, file.name);
        assert.ok(Number.isInteger(file.sizeBytes) && file.sizeBytes > 0);
      }
    }
  });

  it('uses unique ids and file names, and recommends one model of each kind', () => {
    const ids = modelCatalog.map((model) => model.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const model of modelCatalog) {
      const names = model.files.map((file) => file.name);
      assert.equal(new Set(names).size, names.length);
      for (const name of names) {
        assert.doesNotMatch(name, /[/\\]|^\.|\.partial$/, name);
      }
    }
    for (const kind of ['speech', 'summary']) {
      assert.equal(
        modelCatalog.filter((model) => model.kind === kind && model.recommended)
          .length,
        1,
        kind,
      );
    }
  });
});

describe('speech models', () => {
  it('each bring the voice activity model they need to run', () => {
    for (const model of modelCatalog.filter(
      (entry) => entry.kind === 'speech',
    )) {
      assert.ok(
        model.files.some((file) => file.name === 'ggml-silero-v6.2.0.bin'),
        model.id,
      );
    }
  });
});

describe('summary models', () => {
  it('ask for more memory than their files take, and room for a long meeting', () => {
    for (const model of modelCatalog) {
      if (model.kind === 'summary') {
        assert.ok(model.minMemoryBytes > modelSize(model), model.id);
        assert.ok(model.contextTokens >= 16_384, model.id);
      }
    }
  });
});

describe('modelSize', () => {
  it('adds up the sizes of all files of a model', () => {
    assert.equal(
      modelSize({
        files: [
          { name: 'a', url: '', sizeBytes: 10, sha256: '' },
          { name: 'b', url: '', sizeBytes: 5, sha256: '' },
        ],
      }),
      15,
    );
  });
});

describe('phone speech models', () => {
  it('offers Parakeet first, then the small whisper models, each with its voice activity model', () => {
    assert.deepEqual(
      phoneSpeechModels.map((model) => [model.id, model.engine]),
      [
        ['parakeet-tdt-0.6b-v3', 'parakeet'],
        ['whisper-small', 'whisper'],
        ['whisper-base', 'whisper'],
      ],
    );
    for (const model of phoneSpeechModels) {
      assert.ok(
        model.files.some((file) => file.name.startsWith('ggml-silero')),
      );
    }
  });
});
