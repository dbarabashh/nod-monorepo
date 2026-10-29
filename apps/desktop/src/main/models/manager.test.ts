import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { useTempDir } from '../testing/temp-dir.ts';
import type { ModelDefinition, SummaryModel } from '@nod/core/models';
import type { ChosenModels } from '../../shared/ipc.ts';
import { ChecksumError, type Fetch } from './download.ts';
import { stallingFetch } from '../testing/fake-fetch.ts';
import { createModelManager, downloadError } from './manager.ts';

const a = Buffer.from('first file');
const b = Buffer.from('second');
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

const model: ModelDefinition = {
  id: 'tiny',
  name: 'Tiny',
  description: 'A test model',
  languages: 'English',
  license: 'MIT',
  kind: 'speech',
  engine: 'whisper',
  recommended: false,
  files: [
    {
      name: 'a.bin',
      url: 'https://example.test/a',
      sizeBytes: a.length,
      sha256: sha(a),
    },
    {
      name: 'b.bin',
      url: 'https://example.test/b',
      sizeBytes: b.length,
      sha256: sha(b),
    },
  ],
};

const gigabyte = 1024 ** 3;

function summaryModel(id: string, recommended: boolean): SummaryModel {
  return {
    id,
    name: id,
    description: '',
    languages: '',
    license: '',
    kind: 'summary',
    engine: 'llama',
    recommended,
    contextTokens: 1_024,
    minMemoryBytes: 16 * gigabyte,
    files: [
      {
        name: 'w.gguf',
        url: 'https://example.test/a',
        sizeBytes: a.length,
        sha256: sha(a),
      },
    ],
  };
}

const nothingChosen: ChosenModels = { speech: null, summary: null };

const small = summaryModel('small', false);
const usual = summaryModel('usual', true);
const large = summaryModel('large', false);

const serve: Fetch = async (url) =>
  new Response(new Uint8Array(url.endsWith('/a') ? a : b), { status: 200 });

const stallAfter = (bytes: number) =>
  stallingFetch(new Uint8Array(a.subarray(0, bytes)));

describe('createModelManager', () => {
  const dir = useTempDir('models-');

  function manager(fetch: Fetch = serve) {
    return createModelManager({
      catalog: [model],
      directory: dir(),
      fetch,
      memoryBytes: 64 * gigabyte,
      choice: {
        read: async () => ({ speech: null, summary: null }),
        save: async () => {},
      },
      onChange: () => {},
    });
  }

  function summaries(
    options: {
      read?: Promise<ChosenModels>;
      saving?: Promise<void>;
      memoryBytes?: number;
      catalog?: ModelDefinition[];
    } = {},
  ) {
    const saves: ChosenModels[] = [];
    const models = createModelManager({
      catalog: options.catalog ?? [small, usual, large],
      directory: dir(),
      fetch: serve,
      memoryBytes: options.memoryBytes ?? 64 * gigabyte,
      choice: {
        read: () => options.read ?? Promise.resolve(nothingChosen),
        save: async (chosen) => {
          await options.saving;
          saves.push(chosen);
        },
      },
      onChange: () => {},
    });
    return { models, saves };
  }

  async function inUse(models: ReturnType<typeof manager>) {
    return (await models.list())
      .filter((info) => info.inUse)
      .map((info) => info.id);
  }

  async function only(models: ReturnType<typeof manager>) {
    const [info] = await models.list();
    assert.ok(info);
    return info;
  }

  it('lists a model that is not on disk as available', async () => {
    const info = await only(manager());
    assert.equal(info.status, 'available');
    assert.equal(info.downloadedBytes, 0);
    assert.equal(info.sizeBytes, a.length + b.length);
  });

  it('downloads every file and reports the model as downloaded', async () => {
    const models = manager();
    assert.equal((await only(models)).status, 'available');
    await models.download('tiny');
    assert.deepEqual((await readdir(join(dir(), 'tiny'))).sort(), [
      'a.bin',
      'b.bin',
    ]);
    const info = await only(models);
    assert.equal(info.status, 'downloaded');
    assert.equal(info.downloadedBytes, a.length + b.length);
  });

  it('reports a half-finished download as paused with its progress', async () => {
    await mkdir(join(dir(), 'tiny'));
    await writeFile(join(dir(), 'tiny', 'a.bin'), a);
    await writeFile(join(dir(), 'tiny', 'b.bin.partial'), b.subarray(0, 2));
    const info = await only(manager());
    assert.equal(info.status, 'paused');
    assert.equal(info.downloadedBytes, a.length + 2);
  });

  it('does not count a file of the wrong size as downloaded', async () => {
    await mkdir(join(dir(), 'tiny'));
    await writeFile(join(dir(), 'tiny', 'a.bin'), a);
    await writeFile(join(dir(), 'tiny', 'b.bin'), b.subarray(0, 3));
    const info = await only(manager());
    assert.equal(info.status, 'paused');
    assert.equal(info.downloadedBytes, a.length);
  });

  it('keeps the error of a failed download to show it', async () => {
    const models = manager(async () => new Response('', { status: 500 }));
    await models.download('tiny');
    const info = await only(models);
    assert.equal(info.status, 'available');
    assert.equal(info.error, 'network');
  });

  it('deletes every file of a model', async () => {
    const models = manager();
    await models.download('tiny');
    await models.remove('tiny');
    assert.deepEqual(await readdir(dir()), []);
    assert.equal((await only(models)).status, 'available');
  });

  it('offers a model for use only once all of its files are downloaded', async () => {
    const models = manager();
    assert.equal(await models.installed('speech'), null);
    await models.download('tiny');
    const installed = await models.installed('speech');
    assert.equal(installed?.model.id, 'tiny');
    assert.equal(installed?.path('a.bin'), join(dir(), 'tiny', 'a.bin'));
    assert.equal(await models.installed('summary'), null);
  });

  it('uses the recommended model of those downloaded, or else the first', async () => {
    const { models } = summaries();
    await models.download('large');
    await models.download('small');
    assert.equal((await models.installed('summary'))?.model.id, 'small');
    assert.deepEqual(await inUse(models), ['small']);
    await models.download('usual');
    assert.equal((await models.installed('summary'))?.model.id, 'usual');
    assert.deepEqual(await inUse(models), ['usual']);
  });

  it('uses the chosen model and saves the choice', async () => {
    const { models, saves } = summaries();
    await models.download('usual');
    await models.download('large');
    await models.use('large');
    assert.equal((await models.installed('summary'))?.model.id, 'large');
    assert.deepEqual(await inUse(models), ['large']);
    assert.deepEqual(saves, [{ speech: null, summary: 'large' }]);
  });

  it('starts with the choice saved earlier, waiting for it to be read', async () => {
    let read = (_chosen: ChosenModels) => {};
    const { models } = summaries({
      read: new Promise((resolve) => {
        read = resolve;
      }),
    });
    await mkdir(join(dir(), 'usual'));
    await writeFile(join(dir(), 'usual', 'w.gguf'), a);
    await mkdir(join(dir(), 'large'));
    await writeFile(join(dir(), 'large', 'w.gguf'), a);
    const installed = models.installed('summary');
    await new Promise((resolve) => setTimeout(resolve, 20));
    read({ speech: null, summary: 'large' });
    assert.equal((await installed)?.model.id, 'large');
  });

  it('saves choices one after another, so neither undoes the other', async () => {
    let saved = () => {};
    const { models, saves } = summaries({
      catalog: [model, usual],
      saving: new Promise((resolve) => {
        saved = resolve;
      }),
    });
    await models.download('tiny');
    await models.download('usual');
    const first = models.use('tiny');
    const second = models.use('usual');
    await new Promise((resolve) => setTimeout(resolve, 20));
    saved();
    await Promise.all([first, second]);
    assert.deepEqual(saves, [
      { speech: 'tiny', summary: null },
      { speech: 'tiny', summary: 'usual' },
    ]);
  });

  it('falls back to another model once the chosen one is deleted', async () => {
    const { models } = summaries({
      read: Promise.resolve({ speech: null, summary: 'large' }),
    });
    await models.download('usual');
    await models.download('large');
    await models.remove('large');
    assert.equal((await models.installed('summary'))?.model.id, 'usual');
  });

  it('forgets a deleted choice, so the model is not used again unasked', async () => {
    const { models, saves } = summaries();
    await models.download('usual');
    await models.download('large');
    await models.use('large');
    await models.remove('large');
    await models.download('large');
    assert.equal((await models.installed('summary'))?.model.id, 'usual');
    assert.deepEqual(saves, [
      { speech: null, summary: 'large' },
      { speech: null, summary: null },
    ]);
  });

  it('uses a model short of memory only once it is chosen', async () => {
    const { models } = summaries({ memoryBytes: 8 * gigabyte });
    await models.download('large');
    assert.equal(await models.installed('summary'), null);
    assert.deepEqual(await inUse(models), []);
    await models.use('large');
    assert.equal((await models.installed('summary'))?.model.id, 'large');
  });

  it('refuses to use a model that is not downloaded', async () => {
    const { models, saves } = summaries();
    await models.download('usual');
    await assert.rejects(models.use('large'), /not downloaded/);
    await assert.rejects(models.use('../outside'), /Unknown model/);
    assert.deepEqual(saves, []);
    assert.equal((await models.installed('summary'))?.model.id, 'usual');
  });

  it('warns about a summary model that needs more memory than the computer has', async () => {
    const { models } = summaries({ memoryBytes: 8 * gigabyte });
    assert.deepEqual(
      (await models.list()).map((info) => [info.id, info.tooLarge]),
      [
        ['small', true],
        ['usual', true],
        ['large', true],
      ],
    );
    const roomy = createModelManager({
      catalog: [model, usual],
      directory: dir(),
      fetch: serve,
      memoryBytes: 15 * gigabyte,
      choice: {
        read: async () => ({ speech: null, summary: null }),
        save: async () => {},
      },
      onChange: () => {},
    });
    assert.deepEqual(
      (await roomy.list()).map((info) => [info.id, info.tooLarge]),
      [
        ['tiny', false],
        ['usual', false],
      ],
    );
  });

  it('counts a computer as having its memory when the OS reports a little less', async () => {
    const flagged = async (memoryBytes: number) =>
      (await summaries({ memoryBytes }).models.list())[0]?.tooLarge;
    assert.equal(await flagged(14.5 * gigabyte), false);
    assert.equal(await flagged(14 * gigabyte), true);
  });

  it('refuses ids that are not in the catalog', async () => {
    assert.throws(() => manager().download('../outside'), /Unknown model/);
    await assert.rejects(manager().remove('../outside'), /Unknown model/);
  });

  it('pauses without an error and keeps what was downloaded', async () => {
    const { fetch, started } = stallAfter(4);
    const models = manager(fetch);
    const download = models.download('tiny');
    await started;
    await new Promise((resolve) => setTimeout(resolve, 20));
    models.cancel('tiny');
    await download;
    const info = await only(models);
    assert.equal(info.status, 'paused');
    assert.equal(info.downloadedBytes, 4);
    assert.equal(info.error, null);
  });

  it('starts again when asked right after a pause, instead of ignoring it', async () => {
    let first = true;
    const { fetch: stalling, started } = stallAfter(4);
    const fetch: Fetch = (url, init) => {
      if (first) {
        first = false;
        return stalling(url, init);
      }
      return serve(url, init);
    };
    const models = manager(fetch);
    const paused = models.download('tiny');
    await started;
    models.cancel('tiny');
    await models.download('tiny');
    await paused;
    assert.equal((await only(models)).status, 'downloaded');
  });

  it('leaves nothing behind when a model is deleted mid-download', async () => {
    const { fetch, started } = stallAfter(4);
    const models = manager(fetch);
    const download = models.download('tiny');
    await started;
    await models.remove('tiny');
    await download;
    assert.deepEqual(await readdir(dir()), []);
  });
});

describe('downloadError', () => {
  function failure(code: string): Error {
    return Object.assign(new Error(code), { code });
  }

  it('tells disk and permission problems apart from network ones', () => {
    assert.equal(downloadError(failure('ENOSPC')), 'disk-full');
    assert.equal(downloadError(failure('EACCES')), 'not-writable');
    assert.equal(downloadError(new Error('net::ERR_FAILED')), 'network');
    assert.equal(downloadError(new ChecksumError('mismatch')), 'checksum');
  });
});
