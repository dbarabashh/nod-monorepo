import { strict as assert } from 'node:assert';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { useTempDir } from '../testing/temp-dir.ts';
import { createPublishedLogs } from './published-log.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('published log', () => {
  const dir = useTempDir('published-log-');

  it('remembers published versions across restarts, for the same vault and device only', async () => {
    const file = join(dir(), 'sync-published.json');
    const first = createPublishedLogs(file, 0);
    const log = await first.open('vault-a:device-1');
    log.set('m-1', { heads: 'heads-1', version: 'v-1' });
    log.set('m-2', { heads: 'heads-2', version: 'v-2' });
    await settle();
    await first.flushed();

    const again = await createPublishedLogs(file, 0).open('vault-a:device-1');
    assert.deepEqual(again.get('m-1'), { heads: 'heads-1', version: 'v-1' });
    assert.deepEqual(again.get('m-2'), { heads: 'heads-2', version: 'v-2' });
    const other = await createPublishedLogs(file, 0).open('vault-b:device-2');
    assert.equal(other.get('m-1'), undefined);
  });

  it('keeps only version hashes and tags on disk, and only of copies it saw listed', async () => {
    const file = join(dir(), 'sync-published.json');
    const logs = createPublishedLogs(file, 0);
    const log = await logs.open('vault-a:device-1');
    log.set('m-1', { heads: 'heads-1', version: 'v-1' });
    log.set('m-2', { heads: 'heads-2', version: null });
    await settle();
    await logs.flushed();

    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
      scope: 'vault-a:device-1',
      entries: { 'm-1': { heads: 'heads-1', version: 'v-1' } },
    });
  });

  it('reads a log written before the place’s version was kept', async () => {
    const file = join(dir(), 'sync-published.json');
    await writeFile(
      file,
      JSON.stringify({
        scope: 'vault-a:device-1',
        entries: { 'm-1': 'heads-1' },
      }),
    );
    const log = await createPublishedLogs(file, 0).open('vault-a:device-1');
    assert.deepEqual(log.get('m-1'), { heads: 'heads-1', version: null });
  });

  it('starts empty from a damaged file instead of failing sync', async () => {
    const file = join(dir(), 'sync-published.json');
    await writeFile(file, '{not json');
    const log = await createPublishedLogs(file, 0).open('vault-a:device-1');
    assert.equal(log.get('m-1'), undefined);
  });
});
