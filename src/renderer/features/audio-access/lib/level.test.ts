import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { levelFromSamples } from './level.ts';

describe('levelFromSamples', () => {
  it('reads silence and an empty buffer as zero', () => {
    assert.equal(levelFromSamples(new Float32Array(128)), 0);
    assert.equal(levelFromSamples(new Float32Array(0)), 0);
  });

  it('reads a full-scale signal as the top of the meter', () => {
    assert.equal(levelFromSamples(new Float32Array([1, -1, 1, -1])), 1);
  });

  it('maps loudness on a 60 dB scale, so quiet speech still moves the meter', () => {
    const minus20Db = levelFromSamples(new Float32Array([0.1, -0.1]));
    assert.ok(Math.abs(minus20Db - 2 / 3) < 1e-6, `got ${minus20Db}`);
    const minus40Db = levelFromSamples(new Float32Array([0.01, -0.01]));
    assert.ok(Math.abs(minus40Db - 1 / 3) < 1e-6, `got ${minus40Db}`);
  });

  it('never goes below zero for signals under the floor', () => {
    assert.equal(levelFromSamples(new Float32Array([0.0001, -0.0001])), 0);
  });
});
