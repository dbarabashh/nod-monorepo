import { strict as assert } from 'node:assert';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { useTempDir } from '../testing/temp-dir.ts';
import { loadDataKey, type KeyWrap } from './data-key.ts';

const reversing: KeyWrap = {
  wrap: (plain) => Buffer.from(plain).reverse(),
  unwrap: (data) => Buffer.from(data).reverse().toString(),
};

describe('loadDataKey', () => {
  const dir = useTempDir('data-key-');
  const file = () => join(dir(), 'keys', 'data.key');

  it('makes a key once and returns the same key afterwards, wrapped on disk', async () => {
    const first = await loadDataKey(file(), reversing, async () => false);
    const second = await loadDataKey(file(), reversing, async () => true);
    assert.equal(first.length, 32);
    assert.deepEqual(second, first);
    assert.equal(
      (await readFile(file())).includes(first.toString('base64')),
      false,
    );
  });

  it('refuses to make a new key while meetings encrypted with the old one exist', async () => {
    await assert.rejects(
      loadDataKey(file(), reversing, async () => true),
      /missing/,
    );
  });

  it('refuses a damaged key instead of replacing it', async () => {
    await loadDataKey(file(), reversing, async () => false);
    await writeFile(file(), reversing.wrap('c2hvcnQ='));
    await assert.rejects(
      loadDataKey(file(), reversing, async () => false),
      /damaged/,
    );
  });
});
