import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { append, emptyBuffer } from './audio-buffer.ts';
import { drainSpeech, type SpeechEngine } from './drain.ts';

// 16 samples per millisecond: 10 seconds of audio.
const tenSeconds = () => new Int16Array(160_000);

function engine(spans: Array<{ startMs: number; endMs: number }>) {
  const heard: number[] = [];
  const speech: SpeechEngine = {
    detectSpeech: async () => spans,
    transcribe: async (pcm) => {
      heard.push(pcm.length);
      return `words ${heard.length}`;
    },
  };
  return { speech, heard };
}

describe('draining speech from a stream', () => {
  it('transcribes settled speech, times it from the stream start, and keeps the rest', async () => {
    const buffer = emptyBuffer(60_000);
    append(buffer, tenSeconds());
    const { speech, heard } = engine([
      { startMs: 1_000, endMs: 3_000 },
      { startMs: 9_500, endMs: 10_000 },
    ]);
    let ids = 0;

    const lines = await drainSpeech({
      buffer,
      speaker: 'others',
      engine: speech,
      final: false,
      newId: () => `line-${(ids += 1)}`,
    });

    assert.deepEqual(lines, [
      {
        id: 'line-1',
        speaker: 'others',
        startMs: 61_000,
        endMs: 63_000,
        text: 'words 1',
      },
    ]);
    assert.deepEqual(heard, [32_000]);
    assert.equal(buffer.baseMs, 63_000);
    assert.equal(buffer.samples, 112_000);
  });

  it('transcribes everything left at the end', async () => {
    const buffer = emptyBuffer(0);
    append(buffer, tenSeconds());
    const { speech } = engine([{ startMs: 9_500, endMs: 10_000 }]);

    const lines = await drainSpeech({
      buffer,
      speaker: 'me',
      engine: speech,
      final: true,
      newId: () => 'last',
    });

    assert.deepEqual(
      lines.map((line) => [line.startMs, line.endMs]),
      [[9_500, 10_000]],
    );
    assert.equal(buffer.samples, 0);
  });

  it('drops audio no engine can hear, and audio an engine failed on', async () => {
    const unheard = emptyBuffer(0);
    append(unheard, tenSeconds());
    assert.deepEqual(
      await drainSpeech({
        buffer: unheard,
        speaker: 'me',
        engine: null,
        final: false,
        newId: () => 'x',
      }),
      [],
    );
    assert.equal(unheard.samples, 0);

    const failing = emptyBuffer(0);
    append(failing, tenSeconds());
    await assert.rejects(
      drainSpeech({
        buffer: failing,
        speaker: 'me',
        engine: {
          detectSpeech: async () => {
            throw new Error('model gone');
          },
          transcribe: async () => '',
        },
        final: false,
        newId: () => 'x',
      }),
      /model gone/,
    );
    assert.equal(failing.samples, 0);
  });

  it('hands over each line as soon as it is transcribed, keeping them if a later one fails', async () => {
    const buffer = emptyBuffer(0);
    append(buffer, tenSeconds());
    const kept: string[] = [];
    let calls = 0;
    const speech: SpeechEngine = {
      detectSpeech: async () => [
        { startMs: 1_000, endMs: 2_000 },
        { startMs: 5_000, endMs: 6_000 },
      ],
      transcribe: async () => {
        calls += 1;
        if (calls === 2) {
          throw new Error('out of memory');
        }
        return 'first words';
      },
    };

    await assert.rejects(
      drainSpeech({
        buffer,
        speaker: 'others',
        engine: speech,
        final: true,
        newId: () => 'line',
        chunks: { tailMs: 0, maxBufferMs: 10_000, maxChunkMs: 1_000 },
        onLine: async (line) => {
          kept.push(line.text);
        },
      }),
      /out of memory/,
    );
    assert.deepEqual(kept, ['first words']);
  });
});
