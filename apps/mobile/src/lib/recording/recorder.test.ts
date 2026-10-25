import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  createMeetingStore,
  renameMeeting,
  type Cipher,
  type MeetingFiles,
} from '@nod/core/meetings';
import { open, randomKey, seal } from '@nod/core/crypto';
import type { ChunkOptions } from '@nod/core/transcription';
import {
  createPhoneRecorder,
  type Interruption,
  type LoadedEngine,
  type Microphone,
} from './recorder.ts';

const key = randomKey();
const cipher: Cipher = {
  encrypt: (plain, context) => seal(key, plain, context),
  decrypt: (data, context) => open(key, data, context),
};

function memoryFiles(): MeetingFiles {
  const stored = new Map<string, Uint8Array>();
  return {
    ids: async () => [...stored.keys()],
    read: async (id) => stored.get(id) ?? new Uint8Array(),
    write: async (id, data) => {
      stored.set(id, data.slice());
    },
    setAside: async (id) => {
      stored.delete(id);
    },
  };
}

function fakeMicrophone() {
  let send = (_pcm: Int16Array) => {};
  let interrupt = (_state: Interruption) => {};
  let open = false;
  let starts = 0;
  let releases = 0;
  let opening = async () => {};
  const microphone: Microphone = {
    start: async (onAudio, onInterruption) => {
      starts += 1;
      await opening();
      send = onAudio;
      interrupt = onInterruption;
      open = true;
    },
    stop: async () => {
      open = false;
    },
    release: async () => {
      releases += 1;
    },
  };
  return {
    microphone,
    speak: (seconds: number) => send(new Int16Array(seconds * 16_000)),
    interrupt: (state: Interruption) => interrupt(state),
    isOpen: () => open,
    starts: () => starts,
    releases: () => releases,
    whileOpening: (run: () => Promise<void>) => {
      opening = run;
    },
  };
}

// Hears speech up to a second before the end of what it is given, so the
// last second waits for more, and names each chunk.
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeEngine(
  gate: Promise<void> = Promise.resolve(),
  chunks?: ChunkOptions,
) {
  let released = false;
  let releases = 0;
  let spoken = 0;
  const engine: LoadedEngine = {
    detectSpeech: async (audio) => [
      { startMs: 0, endMs: audio.length / 16 - 1_000 },
    ],
    transcribe: async () => {
      await gate;
      return `part ${(spoken += 1)}`;
    },
    release: async () => {
      released = true;
      releases += 1;
    },
    chunks,
  };
  return { engine, released: () => released, releases: () => releases };
}

async function setUp(
  options: {
    transcribing?: Promise<void>;
    loaded?: Promise<void>;
    loadFails?: boolean;
    chunks?: ChunkOptions;
  } = {},
) {
  const store = createMeetingStore({
    files: memoryFiles(),
    cipher: async () => cipher,
  });
  await store.load();
  const mic = fakeMicrophone();
  const speech = fakeEngine(options.transcribing, options.chunks);
  const timers = new Map<number, () => void>();
  const laters = new Set<() => void>();
  let clock = 1_000;
  let ids = 0;
  let loads = 0;
  const recorder = createPhoneRecorder({
    store,
    microphone: mic.microphone,
    loadEngine: async () => {
      loads += 1;
      await options.loaded;
      if (options.loadFails) {
        throw new Error('not enough memory');
      }
      return speech.engine;
    },
    title: () => 'Meeting on Monday',
    newId: () => `id-${(ids += 1)}`,
    now: () => clock,
    every: (ms, run) => {
      timers.set(ms, run);
      return () => timers.delete(ms);
    },
    later: (_ms, run) => {
      laters.add(run);
      return () => laters.delete(run);
    },
    onChange: () => {},
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    store,
    mic,
    speech,
    recorder,
    timers,
    settle,
    tick: (ms: number) => {
      clock += ms;
    },
    loads: () => loads,
    runLater: () => {
      const due = [...laters];
      laters.clear();
      for (const run of due) {
        run();
      }
    },
  };
}

describe('recording on the phone', () => {
  it('saves the transcript while recording and finishes the meeting on stop', async () => {
    const { store, mic, speech, recorder, timers, settle, tick, runLater } =
      await setUp();
    const id = await recorder.start();
    assert.equal(store.meeting(id)?.title, 'Meeting on Monday');
    assert.equal(mic.isOpen(), true);

    mic.speak(5);
    tick(2_000);
    timers.get(2_000)?.();
    await settle();
    await settle();
    assert.deepEqual(
      store.meeting(id)?.transcript.map((line) => line.text),
      ['part 1'],
    );

    tick(3_000);
    timers.get(5_000)?.();
    mic.speak(1);
    await recorder.finish();
    await recorder.settled();

    const meeting = store.meeting(id);
    assert.deepEqual(
      meeting?.transcript.map((line) => [line.text, line.startMs]),
      [
        ['part 1', 0],
        ['part 2', 4_000],
      ],
    );
    assert.equal(meeting?.finishedAt, 6_000);
    assert.deepEqual(meeting?.segments, [{ startedAt: 1_000, endedAt: 6_000 }]);
    assert.equal(mic.isOpen(), false);
    assert.equal(mic.releases(), 1);
    assert.equal(timers.size, 0);
    assert.equal(recorder.state().status, 'idle');

    assert.equal(speech.released(), false);
    runLater();
    await settle();
    assert.equal(speech.released(), true);
  });

  it('cuts speech into the phone’s short chunks unless the engine asks for longer ones', async () => {
    const lines = async (chunks?: ChunkOptions) => {
      const { store, mic, recorder } = await setUp({ chunks });
      const id = await recorder.start();
      mic.speak(25);
      await recorder.finish();
      await recorder.settled();
      return store.meeting(id)?.transcript.map((line) => line.startMs);
    };
    assert.deepEqual(await lines(), [0, 10_000, 20_000]);
    assert.deepEqual(
      await lines({ tailMs: 800, maxBufferMs: 30_000, maxChunkMs: 28_000 }),
      [0],
    );
  });

  it('keeps a change made elsewhere while it records', async () => {
    const { store, mic, recorder, timers, settle, tick } = await setUp();
    const id = await recorder.start();
    const before = store.meeting(id);
    assert.ok(before);
    await store.save(renameMeeting(before, 'Renamed on the computer'));

    mic.speak(3);
    tick(2_000);
    timers.get(2_000)?.();
    await settle();
    await recorder.finish();
    await recorder.settled();

    assert.equal(store.meeting(id)?.title, 'Renamed on the computer');
    assert.equal(store.meeting(id)?.transcript.length, 1);
  });

  it('shows a call pausing it, and pauses the meeting when the microphone is lost', async () => {
    const { store, mic, recorder, settle } = await setUp();
    const id = await recorder.start();

    mic.interrupt('began');
    const paused = recorder.state();
    assert.equal(paused.status === 'recording' && paused.interrupted, true);
    mic.interrupt('ended');
    const resumed = recorder.state();
    assert.equal(resumed.status === 'recording' && resumed.interrupted, false);

    mic.interrupt('lost');
    for (let round = 0; round < 6; round += 1) {
      await settle();
    }
    assert.equal(recorder.state().status, 'paused');
    assert.equal(store.meeting(id)?.finishedAt, null);
    assert.equal(mic.isOpen(), false);
  });

  it('leaves no meeting behind when the microphone can’t open', async () => {
    const { store, speech, settle } = await setUp();
    let cool = () => {};
    const recorder = createPhoneRecorder({
      store,
      microphone: {
        start: async () => {
          throw new Error('Microphone access is off');
        },
        stop: async () => {},
        release: async () => {},
      },
      loadEngine: async () => speech.engine,
      title: () => 'Meeting',
      newId: () => 'never',
      now: () => 1,
      every: () => () => {},
      later: (_ms, run) => {
        cool = run;
        return () => {};
      },
      onChange: () => {},
    });

    await assert.rejects(recorder.start(), /Microphone access is off/);
    assert.deepEqual(store.ids(), []);
    await settle();
    cool();
    await settle();
    assert.equal(speech.released(), true);
  });

  it('finishes once when asked twice, without transcribing the same audio again', async () => {
    const { store, mic, speech, recorder, settle, runLater } = await setUp();
    const id = await recorder.start();
    mic.speak(3);

    await Promise.all([recorder.finish(), recorder.finish()]);
    await recorder.settled();
    runLater();
    await settle();

    assert.equal(store.meeting(id)?.transcript.length, 1);
    assert.equal(speech.releases(), 1);
    assert.equal(mic.releases(), 1);
  });

  it('opens one engine and one microphone when started twice at once', async () => {
    const { mic, recorder, loads } = await setUp();

    const [first, second] = await Promise.all([
      recorder.start(),
      recorder.start(),
    ]);

    assert.equal(first, second);
    assert.equal(loads(), 1);
    assert.equal(mic.starts(), 1);
    await recorder.finish();
  });

  it('honours a finish asked for while it is still starting', async () => {
    const { store, mic, recorder } = await setUp();

    const starting = recorder.start();
    const stopping = recorder.finish();
    const id = await starting;
    await stopping;
    await recorder.settled();

    assert.equal(recorder.state().status, 'idle');
    assert.equal(mic.isOpen(), false);
    assert.notEqual(store.meeting(id)?.finishedAt, null);
  });

  it('skips the oldest audio when the engine falls minutes behind, and says so', async () => {
    const { mic, recorder } = await setUp();
    await recorder.start();

    mic.speak(200);

    const state = recorder.state();
    assert.match(
      state.status === 'recording' ? (state.problem ?? '') : '',
      /couldn’t keep up/,
    );
    await recorder.finish();
  });

  it('stops when the meeting is deleted on another device', async () => {
    const { store, recorder, timers, settle, tick } = await setUp();
    const id = await recorder.start();
    await store.remove(id, 2_000);

    tick(5_000);
    timers.get(5_000)?.();
    for (let round = 0; round < 6; round += 1) {
      await settle();
    }

    assert.equal(recorder.state().status, 'idle');
    assert.match(recorder.state().problem ?? '', /deleted on another device/);
  });

  it('pauses and resumes one meeting, its clock and transcript going on', async () => {
    const { store, mic, recorder, tick, loads } = await setUp();
    const id = await recorder.start();
    mic.speak(3);
    tick(3_000);
    await recorder.pause();
    await recorder.settled();

    const paused = recorder.state();
    assert.equal(paused.status, 'paused');
    assert.equal(mic.isOpen(), false);
    assert.equal(store.meeting(id)?.finishedAt, null);

    tick(60_000);
    assert.equal(await recorder.resume(id), id);
    const resumed = recorder.state();
    assert.equal(resumed.status === 'recording' && resumed.previousMs, 3_000);
    mic.speak(2);
    tick(2_000);
    await recorder.finish();
    await recorder.settled();

    const meeting = store.meeting(id);
    assert.deepEqual(meeting?.segments, [
      { startedAt: 1_000, endedAt: 4_000 },
      { startedAt: 64_000, endedAt: 66_000 },
    ]);
    assert.deepEqual(
      meeting?.transcript.map((line) => [line.text, line.startMs]),
      [
        ['part 1', 0],
        ['part 2', 3_000],
      ],
    );
    assert.equal(meeting?.finishedAt, 66_000);
    assert.equal(loads(), 1);
  });

  it('finishes a paused meeting where it was paused', async () => {
    const { store, recorder, tick } = await setUp();
    const id = await recorder.start();
    tick(5_000);
    await recorder.pause();
    tick(600_000);

    await recorder.finish();

    assert.equal(store.meeting(id)?.finishedAt, 6_000);
    assert.equal(recorder.state().status, 'idle');
  });

  it('records at once while the model loads, and transcribes what it heard meanwhile', async () => {
    const loaded = deferred();
    const { store, mic, recorder, timers, settle, tick } = await setUp({
      loaded: loaded.promise,
    });

    const id = await recorder.start();
    assert.equal(mic.isOpen(), true);
    assert.equal(recorder.state().status, 'recording');

    mic.speak(5);
    tick(2_000);
    timers.get(2_000)?.();
    await settle();
    assert.deepEqual(store.meeting(id)?.transcript, []);

    loaded.resolve();
    await settle();
    timers.get(2_000)?.();
    await settle();
    await settle();
    assert.deepEqual(
      store.meeting(id)?.transcript.map((line) => [line.text, line.startMs]),
      [['part 1', 0]],
    );
    await recorder.finish();
  });

  it('stops at once and finishes the transcript in the background', async () => {
    const transcribing = deferred();
    const { store, mic, recorder, settle, tick } = await setUp({
      transcribing: transcribing.promise,
    });
    const id = await recorder.start();
    mic.speak(3);
    tick(3_000);

    await recorder.finish();
    await settle();
    assert.equal(store.meeting(id)?.finishedAt, 4_000);
    assert.equal(recorder.state().status, 'idle');
    assert.equal(mic.isOpen(), false);
    assert.equal(recorder.transcribing(id), true);
    await settle();
    assert.deepEqual(store.meeting(id)?.transcript, []);
    assert.equal(mic.releases(), 0);

    transcribing.resolve();
    await recorder.settled();
    assert.deepEqual(
      store.meeting(id)?.transcript.map((line) => line.text),
      ['part 1'],
    );
    assert.equal(recorder.transcribing(id), false);
    assert.equal(mic.releases(), 1);
  });

  it('keeps the model loaded for the next recording, then gives it back', async () => {
    const { speech, recorder, loads, settle, runLater } = await setUp();
    await recorder.start();
    await recorder.finish();
    await recorder.settled();

    await recorder.start();
    runLater();
    await settle();
    assert.equal(speech.released(), false);
    await recorder.finish();
    await recorder.settled();
    assert.equal(loads(), 1);

    runLater();
    await settle();
    assert.equal(speech.releases(), 1);
  });

  it('keeps the app running while the next recording starts before the last is saved', async () => {
    const transcribing = deferred();
    const { mic, recorder } = await setUp({
      transcribing: transcribing.promise,
    });
    await recorder.start();
    mic.speak(3);
    await recorder.finish();
    await recorder.start();

    transcribing.resolve();
    await recorder.settled();
    assert.equal(mic.releases(), 0);
    assert.equal(mic.isOpen(), true);

    await recorder.finish();
    await recorder.settled();
    assert.equal(mic.releases(), 1);
  });

  it('keeps the app running until every stop of a meeting is transcribed', async () => {
    const transcribing = deferred();
    const { mic, recorder } = await setUp({
      transcribing: transcribing.promise,
    });
    const id = await recorder.start();
    mic.speak(3);
    await recorder.pause();
    await recorder.resume(id);
    mic.speak(3);
    await recorder.pause();

    const seen: Array<[boolean, number]> = [];
    const watch = setInterval(
      () => seen.push([recorder.transcribing(id), mic.releases()]),
      0,
    );
    transcribing.resolve();
    await recorder.settled();
    clearInterval(watch);
    assert.equal(
      seen.some(([busy, releases]) => !busy && releases === 0),
      false,
    );
    assert.equal(recorder.transcribing(id), false);
    assert.equal(mic.releases(), 1);
  });

  it('lets the app be suspended again when the meeting can’t be saved after the microphone opened', async () => {
    const { store, speech } = await setUp();
    let releases = 0;
    const recorder = createPhoneRecorder({
      store: {
        ...store,
        save: async () => {
          throw new Error('disk full');
        },
      },
      microphone: {
        start: async () => {},
        stop: async () => {},
        release: async () => {
          releases += 1;
        },
      },
      loadEngine: async () => speech.engine,
      title: () => 'Meeting',
      newId: () => 'id',
      now: () => 1,
      every: () => () => {},
      later: () => () => {},
      onChange: () => {},
    });

    await assert.rejects(recorder.start(), /disk full/);
    assert.equal(releases, 1);
  });

  it('pauses and says why when the model can’t load, even before the microphone opened', async () => {
    const { mic, recorder, settle } = await setUp({ loadFails: true });
    const id = await recorder.start();
    mic.speak(3);
    for (let round = 0; round < 6; round += 1) {
      await settle();
    }
    await recorder.settled();

    const state = recorder.state();
    assert.equal(state.status, 'paused');
    assert.equal(state.status === 'paused' && state.meetingId, id);
    assert.match(state.problem ?? '', /speech model couldn’t load/);
  });

  it('keeps the one model while the end of a paused meeting is still being transcribed', async () => {
    const transcribing = deferred();
    const { mic, speech, recorder, settle, runLater, loads } = await setUp({
      transcribing: transcribing.promise,
    });
    const id = await recorder.start();
    mic.speak(3);
    await recorder.pause();

    runLater();
    await settle();
    await recorder.resume(id);
    assert.equal(loads(), 1);

    transcribing.resolve();
    await recorder.finish();
    await recorder.settled();
    runLater();
    await settle();
    assert.equal(speech.releases(), 1);
  });

  it('loads a failing model once, keeping the reason it failed', async () => {
    const loaded = deferred();
    const { mic, recorder, settle, loads } = await setUp({
      loadFails: true,
      loaded: loaded.promise,
    });
    await recorder.start();
    mic.speak(3);
    loaded.resolve();
    for (let round = 0; round < 6; round += 1) {
      await settle();
    }
    await recorder.finish();
    await recorder.settled();

    assert.equal(loads(), 1);
    assert.match(recorder.state().problem ?? '', /speech model couldn’t load/);
  });

  it('refuses to resume a meeting finished on another device meanwhile', async () => {
    const { store, mic, recorder } = await setUp();
    const id = await recorder.start();
    await recorder.pause();
    await recorder.settled();
    mic.whileOpening(async () => {
      const paused = store.meeting(id);
      assert.ok(paused);
      await store.save({ ...paused, finishedAt: 9_000 });
    });

    await assert.rejects(recorder.resume(id), /cannot be resumed/);
    assert.equal(store.meeting(id)?.segments.length, 1);
    assert.equal(recorder.state().status, 'paused');
    assert.equal(mic.isOpen(), false);
  });
});
