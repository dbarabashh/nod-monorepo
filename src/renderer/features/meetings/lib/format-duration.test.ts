import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { formatDuration } from './format-duration.ts';

describe('formatDuration', () => {
  it('shows anything under a minute as "<1 min"', () => {
    assert.equal(formatDuration(0), '<1 min');
    assert.equal(formatDuration(59), '<1 min');
  });

  it('shows a dash instead of a number for an invalid duration', () => {
    assert.equal(formatDuration(Number.NaN), '—');
    assert.equal(formatDuration(Number.POSITIVE_INFINITY), '—');
    assert.equal(formatDuration(-1), '—');
  });

  it('shows whole minutes and drops leftover seconds', () => {
    assert.equal(formatDuration(60), '1 min');
    assert.equal(formatDuration(45 * 60 + 59), '45 min');
    assert.equal(formatDuration(59 * 60 + 59), '59 min');
  });

  it('shows hours alone when there are no extra minutes', () => {
    assert.equal(formatDuration(2 * 3600), '2 h');
  });

  it('shows hours and minutes past the hour', () => {
    assert.equal(formatDuration(3600 + 5 * 60), '1 h 5 min');
  });
});
