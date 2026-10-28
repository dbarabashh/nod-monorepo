import { strict as assert } from 'node:assert';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { useTempDir } from '../testing/temp-dir.ts';
import { createAppStateStore } from './store.ts';

describe('createAppStateStore', () => {
  const dir = useTempDir('app-state-');
  let file: string;

  beforeEach(() => {
    file = join(dir(), 'app-state.json');
  });

  it('starts with onboarding not completed when nothing is saved', async () => {
    assert.deepEqual(await createAppStateStore(file).read(), {
      onboardingCompleted: false,
      suggestMeetings: true,
      quietMeetingApps: [],
      checkForUpdates: true,
      testUpdates: false,
    });
  });

  it('keeps a completed onboarding across store instances', async () => {
    await createAppStateStore(file).update({ onboardingCompleted: true });
    assert.deepEqual(await createAppStateStore(file).read(), {
      onboardingCompleted: true,
      suggestMeetings: true,
      quietMeetingApps: [],
      checkForUpdates: true,
      testUpdates: false,
    });
    assert.equal(
      await readFile(file, 'utf8'),
      '{"onboardingCompleted":true,"suggestMeetings":true,"quietMeetingApps":[],"checkForUpdates":true,"testUpdates":false}',
    );
  });

  it('runs overlapping updates one after another', async () => {
    const store = createAppStateStore(file);
    assert.deepEqual(
      await Promise.all([
        store.update({ onboardingCompleted: true }),
        store.update({ onboardingCompleted: true }),
      ]),
      [
        {
          onboardingCompleted: true,
          suggestMeetings: true,
          quietMeetingApps: [],
          checkForUpdates: true,
          testUpdates: false,
        },
        {
          onboardingCompleted: true,
          suggestMeetings: true,
          quietMeetingApps: [],
          checkForUpdates: true,
          testUpdates: false,
        },
      ],
    );
    assert.deepEqual(await readdir(dir()), ['app-state.json']);
  });

  it('falls back to defaults when the file is not valid JSON', async () => {
    await writeFile(file, '{oops', 'utf8');
    assert.deepEqual(await createAppStateStore(file).read(), {
      onboardingCompleted: false,
      suggestMeetings: true,
      quietMeetingApps: [],
      checkForUpdates: true,
      testUpdates: false,
    });
  });

  it('applies changes that build on the saved state one after another', async () => {
    const store = createAppStateStore(file);
    await Promise.all([
      store.update((state) => ({
        quietMeetingApps: [...state.quietMeetingApps, 'zoom'],
      })),
      store.update((state) => ({
        quietMeetingApps: [...state.quietMeetingApps, 'teams'],
      })),
    ]);
    assert.deepEqual(
      (await createAppStateStore(file).read()).quietMeetingApps,
      ['zoom', 'teams'],
    );
  });
});
