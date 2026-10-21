import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { planChunks } from './chunks.ts';

describe('planChunks', () => {
  it('waits while someone may still be talking at the end of the buffer', () => {
    assert.deepEqual(
      planChunks([{ startMs: 500, endMs: 9_700 }], 10_000, false),
      {
        chunks: [],
        consumeMs: 0,
      },
    );
  });

  it('sends finished phrases together and keeps the audio after them', () => {
    assert.deepEqual(
      planChunks(
        [
          { startMs: 200, endMs: 2_000 },
          { startMs: 2_400, endMs: 5_000 },
          { startMs: 9_500, endMs: 10_000 },
        ],
        10_000,
        false,
      ),
      { chunks: [{ startMs: 200, endMs: 5_000 }], consumeMs: 5_000 },
    );
  });

  it('splits phrases that would not fit in one model window', () => {
    assert.deepEqual(
      planChunks(
        [
          { startMs: 0, endMs: 20_000 },
          { startMs: 21_000, endMs: 29_000 },
        ],
        29_900,
        true,
      ).chunks,
      [
        { startMs: 0, endMs: 20_000 },
        { startMs: 21_000, endMs: 29_000 },
      ],
    );
  });

  it('drops silence but keeps a short tail in case speech is starting', () => {
    assert.deepEqual(planChunks([], 6_000, false), {
      chunks: [],
      consumeMs: 5_200,
    });
  });

  it('cuts a monologue that fills the buffer instead of waiting forever', () => {
    assert.deepEqual(
      planChunks([{ startMs: 100, endMs: 31_000 }], 30_000, false),
      {
        chunks: [
          { startMs: 100, endMs: 28_100 },
          { startMs: 28_100, endMs: 30_000 },
        ],
        consumeMs: 30_000,
      },
    );
  });

  it('cuts one phrase longer than the model window into pieces that fit', () => {
    assert.deepEqual(
      planChunks([{ startMs: 0, endMs: 31_000 }], 31_000, false),
      {
        chunks: [
          { startMs: 0, endMs: 28_000 },
          { startMs: 28_000, endMs: 31_000 },
        ],
        consumeMs: 31_000,
      },
    );
  });

  it('transcribes everything that is left when recording pauses', () => {
    assert.deepEqual(
      planChunks([{ startMs: 500, endMs: 9_900 }], 10_000, true),
      {
        chunks: [{ startMs: 500, endMs: 9_900 }],
        consumeMs: 9_900,
      },
    );
  });
});
