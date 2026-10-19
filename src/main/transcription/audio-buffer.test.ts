import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { append, consume, emptyBuffer, snapshot } from './audio-buffer.ts';

const samplesPerMs = 1;

describe('audio buffer', () => {
  it('keeps audio that arrived while a snapshot was being transcribed', () => {
    const buffer = emptyBuffer(0);
    append(buffer, Int16Array.of(1, 2, 3, 4));
    const taken = snapshot(buffer);
    append(buffer, Int16Array.of(5, 6));

    consume(buffer, taken, 3, samplesPerMs);

    assert.deepEqual(Array.from(snapshot(buffer).audio), [4, 5, 6]);
    assert.equal(buffer.samples, 3);
    assert.equal(buffer.baseMs, 3);
  });

  it('empties when everything taken was used and nothing new came', () => {
    const buffer = emptyBuffer(1_000);
    append(buffer, Int16Array.of(1, 2));
    consume(buffer, snapshot(buffer), 2, samplesPerMs);
    assert.deepEqual(buffer, { parts: [], samples: 0, baseMs: 1_002 });
  });
});
