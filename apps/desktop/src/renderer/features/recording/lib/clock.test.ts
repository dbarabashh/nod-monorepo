import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { elapsedMs } from './clock.ts';

describe('elapsedMs', () => {
  it('adds the current segment to the time already recorded', () => {
    assert.equal(
      elapsedMs(
        {
          status: 'recording',
          meetingId: 'm',
          segmentStartedAt: 10_000,
          previousMs: 60_000,
        },
        25_000,
      ),
      75_000,
    );
  });

  it('is zero when idle and never runs backwards on a clock change', () => {
    assert.equal(elapsedMs({ status: 'idle' }, 25_000), 0);
    assert.equal(
      elapsedMs(
        {
          status: 'recording',
          meetingId: 'm',
          segmentStartedAt: 30_000,
          previousMs: 5_000,
        },
        25_000,
      ),
      5_000,
    );
  });
});
