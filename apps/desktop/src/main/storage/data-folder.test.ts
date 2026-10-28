import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { describe, it } from 'node:test';
import { useTempDir } from '../testing/temp-dir.ts';
import { moveDataFolder } from './data-folder.ts';

async function put(file: string, text: string) {
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, text);
}

async function listing(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true }))
    .map((entry) => entry.split(sep).join('/'))
    .sort();
}

describe('moving the data folder', () => {
  const dir = useTempDir('data-folder-');
  const old = () => join(dir(), 'Nod');
  const next = () => join(dir(), 'Nod Desktop');

  it("moves this app's files and models and leaves the Swift app's", async () => {
    await put(join(old(), 'keys', 'data.key'), 'key');
    await put(join(old(), 'meetings', 'a.bin'), 'meeting');
    await put(join(old(), 'sharing', 'shares.bin'), 'shares');
    await put(join(old(), 'published', 'log.bin'), 'log');
    await put(join(old(), 'app-state.json'), '{}');
    await put(join(old(), 'sync.json'), '{}');
    await put(join(old(), 'mcp.bin'), 'mcp');
    await put(join(old(), 'models', 'whisper-small', 'model.bin'), 'w');
    await put(join(old(), 'models', 'argmaxinc', 'swift.bin'), 'swift');
    await put(join(old(), 'outbox', 'pending.json'), 'swift');
    await put(join(old(), 'ambient-context.enabled'), '');

    assert.equal(
      moveDataFolder(old(), next(), ['whisper-small', 'whisper-base']),
      'moved',
    );

    assert.deepEqual(await listing(next()), [
      'app-state.json',
      'keys',
      'keys/data.key',
      'mcp.bin',
      'meetings',
      'meetings/a.bin',
      'models',
      'models/whisper-small',
      'models/whisper-small/model.bin',
      'published',
      'published/log.bin',
      'sharing',
      'sharing/shares.bin',
      'sync.json',
    ]);
    assert.deepEqual(await listing(old()), [
      'ambient-context.enabled',
      'models',
      'models/argmaxinc',
      'models/argmaxinc/swift.bin',
      'outbox',
      'outbox/pending.json',
    ]);
    assert.equal(
      await readFile(join(next(), 'keys', 'data.key'), 'utf8'),
      'key',
    );
  });

  it('leaves both folders alone once the new one has a data key', async () => {
    await put(join(next(), 'keys', 'data.key'), 'new key');
    await put(join(old(), 'keys', 'data.key'), 'old key');
    await put(join(old(), 'meetings', 'a.bin'), 'old meeting');

    assert.equal(moveDataFolder(old(), next(), []), 'moved');

    assert.deepEqual(await listing(next()), ['keys', 'keys/data.key']);
    assert.deepEqual(await listing(old()), [
      'keys',
      'keys/data.key',
      'meetings',
      'meetings/a.bin',
    ]);
  });

  it('finishes a move that stopped before the key, replacing nothing', async () => {
    await put(join(next(), 'meetings', 'a.bin'), 'moved meeting');
    await put(join(old(), 'meetings', 'a.bin'), 'stale meeting');
    await put(join(next(), 'sync.json'), 'moved settings');
    await put(join(old(), 'sync.json'), 'stale settings');
    await put(join(old(), 'keys', 'data.key'), 'key');

    assert.equal(moveDataFolder(old(), next(), []), 'moved');

    assert.equal(
      await readFile(join(next(), 'meetings', 'a.bin'), 'utf8'),
      'moved meeting',
    );
    assert.equal(
      await readFile(join(next(), 'sync.json'), 'utf8'),
      'moved settings',
    );
    assert.equal(
      await readFile(join(next(), 'keys', 'data.key'), 'utf8'),
      'key',
    );
    assert.deepEqual(await listing(old()), [
      'meetings',
      'meetings/a.bin',
      'sync.json',
    ]);
  });

  it('puts everything back when one move fails, so the key stays with the meetings', async () => {
    await put(join(old(), 'keys', 'data.key'), 'key');
    await put(join(old(), 'meetings', 'a.bin'), 'meeting');
    await put(join(old(), 'models', 'whisper-small', 'model.bin'), 'w');
    await put(join(next(), 'models'), 'a file where the models folder goes');

    assert.equal(moveDataFolder(old(), next(), ['whisper-small']), 'kept');

    assert.deepEqual(await listing(old()), [
      'keys',
      'keys/data.key',
      'meetings',
      'meetings/a.bin',
      'models',
      'models/whisper-small',
      'models/whisper-small/model.bin',
    ]);
    assert.deepEqual(await listing(next()), ['models']);
  });

  it('does nothing when there is no old folder', () => {
    assert.equal(moveDataFolder(old(), next(), ['whisper-small']), 'moved');
    assert.equal(existsSync(next()), false);
  });
});
