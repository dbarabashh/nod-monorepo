import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { levelFromPcm } from './audio-level.ts';

describe('levelFromPcm', () => {
  it('is silent for no audio and for zeros', () => {
    assert.equal(levelFromPcm(new Int16Array(0)), 0);
    assert.equal(levelFromPcm(new Int16Array(160)), 0);
  });

  it('is full at full scale', () => {
    assert.equal(levelFromPcm(new Int16Array(160).fill(-32768)), 1);
  });

  it('maps -30 dB to the middle of a 60 dB range', () => {
    const amplitude = Math.round(32768 * 10 ** (-30 / 20));
    const level = levelFromPcm(new Int16Array(160).fill(amplitude));
    assert.ok(Math.abs(level - 0.5) < 0.001, `level was ${level}`);
  });

  it('stays at zero below the -60 dB floor', () => {
    assert.equal(levelFromPcm(new Int16Array(160).fill(16)), 0);
  });
});
