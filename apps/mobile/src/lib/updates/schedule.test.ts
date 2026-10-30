import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { Update } from './find.ts';
import { afterCheck, isBusy, knownUpdate } from './schedule.ts';

const update: Update = {
  version: '1.3.0',
  tag: 'mobile-v1.3.0',
  url: 'https://github.com/example/nod/releases/download/mobile-v1.3.0/Nod-1.3.0.apk',
  page: 'https://github.com/example/nod/releases/tag/mobile-v1.3.0',
  size: 10,
  sha256: 'b'.repeat(64),
};
const now = 1_000_000;

describe('afterCheck', () => {
  it('checks again in six hours after a check that worked', () => {
    assert.deepEqual(afterCheck({ found: update }, null, now), {
      state: { status: 'available', update },
      nextCheck: now + 21_600_000,
    });
    assert.deepEqual(afterCheck({ found: null }, null, now), {
      state: { status: 'current' },
      nextCheck: now + 21_600_000,
    });
  });

  it('tries again in an hour and keeps the update it already found', () => {
    assert.deepEqual(
      afterCheck({ failure: 'api.github.com answered 403.' }, update, now),
      {
        state: {
          status: 'failed',
          message: 'api.github.com answered 403.',
          update,
        },
        nextCheck: now + 3_600_000,
      },
    );
  });
});

describe('isBusy', () => {
  it('refuses a second check or install while one runs', () => {
    assert.equal(isBusy({ status: 'checking', update: null }), true);
    assert.equal(
      isBusy({ status: 'downloading', update, progress: 0.5 }),
      true,
    );
    assert.equal(isBusy({ status: 'installing', update }), true);
    assert.equal(isBusy({ status: 'available', update }), false);
    assert.equal(isBusy({ status: 'failed', message: 'x', update }), false);
  });
});

it('knownUpdate finds the update a state carries', () => {
  assert.equal(knownUpdate({ status: 'failed', message: 'x', update }), update);
  assert.equal(knownUpdate({ status: 'current' }), null);
});
