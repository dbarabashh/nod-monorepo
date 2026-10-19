import { strict as assert } from 'node:assert';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createAppStateStore } from './store.ts';

describe('createAppStateStore', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'app-state-'));
    file = join(dir, 'app-state.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('starts with onboarding not completed when nothing is saved', async () => {
    assert.deepEqual(await createAppStateStore(file).read(), {
      onboardingCompleted: false,
    });
  });

  it('keeps a completed onboarding across store instances', async () => {
    await createAppStateStore(file).update({ onboardingCompleted: true });
    assert.deepEqual(await createAppStateStore(file).read(), {
      onboardingCompleted: true,
    });
    assert.equal(await readFile(file, 'utf8'), '{"onboardingCompleted":true}');
  });

  it('runs overlapping updates one after another', async () => {
    const store = createAppStateStore(file);
    assert.deepEqual(
      await Promise.all([
        store.update({ onboardingCompleted: true }),
        store.update({ onboardingCompleted: true }),
      ]),
      [{ onboardingCompleted: true }, { onboardingCompleted: true }],
    );
    assert.deepEqual(await readdir(dir), ['app-state.json']);
  });

  it('falls back to defaults when the file is not valid JSON', async () => {
    await writeFile(file, '{oops', 'utf8');
    assert.deepEqual(await createAppStateStore(file).read(), {
      onboardingCompleted: false,
    });
  });
});
