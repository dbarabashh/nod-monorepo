import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { formatClock } from './format-clock.ts';

describe('formatClock', () => {
  it('shows minutes and seconds, adding hours only when needed', () => {
    assert.equal(formatClock(0), '0:00');
    assert.equal(formatClock(65_999), '1:05');
    assert.equal(formatClock(3_600_000 + 2 * 60_000 + 3_000), '1:02:03');
  });
});
