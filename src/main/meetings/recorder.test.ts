import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { startMeeting, type Meeting } from '../../core/meetings/index.ts';
import { createRecorder } from './recorder.ts';
import type { MeetingStore } from './store.ts';

function setup(initial: Meeting[] = []) {
  let time = 1_000;
  let saved: Meeting[] = initial;
  let tick = () => {};
  let ticking = false;
  let ids = 0;
  const store: MeetingStore = {
    load: async () => saved,
    save: async (meetings) => {
      saved = meetings;
    },
    flush: async () => {},
  };
  const recorder = createRecorder({
    store,
    now: () => time,
    newId: () => `m${++ids}`,
    every: (callback) => {
      tick = callback;
      ticking = true;
      return () => {
        ticking = false;
      };
    },
    onChange: () => {},
  });
  return {
    recorder,
    advance: (ms: number) => {
      time += ms;
    },
    tick: () => tick(),
    saved: () => saved,
    ticking: () => ticking,
  };
}

describe('createRecorder', () => {
  it('records a new meeting until it is stopped', async () => {
    const { recorder, advance, saved } = setup();
    await recorder.load();
    const id = await recorder.start('Standup');
    assert.deepEqual(recorder.state(), {
      status: 'recording',
      meetingId: id,
      segmentStartedAt: 1_000,
      previousMs: 0,
    });
    advance(90_000);
    await recorder.pause();

    assert.deepEqual(recorder.state(), { status: 'idle' });
    assert.deepEqual(saved(), [
      {
        id,
        title: 'Standup',
        segments: [{ startedAt: 1_000, endedAt: 91_000 }],
        finishedAt: null,
        transcript: [],
        summary: null,
      },
    ]);
  });

  it('keeps saving while recording, so a crash loses seconds, not the meeting', async () => {
    const { recorder, advance, tick, saved, ticking } = setup();
    await recorder.load();
    await recorder.start('Standup');
    advance(10_000);
    tick();
    await Promise.resolve();
    assert.equal(saved()[0]?.segments[0]?.endedAt, 11_000);
    await recorder.pause();
    assert.equal(ticking(), false);
  });

  it('resumes a meeting as a new segment and counts the earlier time', async () => {
    const earlier: Meeting = {
      id: 'old',
      title: 'Planning',
      segments: [{ startedAt: 0, endedAt: 600 }],
      finishedAt: null,
      transcript: [],
      summary: null,
    };
    const { recorder, advance, saved } = setup([earlier]);
    await recorder.load();
    await recorder.resume('old');
    assert.deepEqual(recorder.state(), {
      status: 'recording',
      meetingId: 'old',
      segmentStartedAt: 1_000,
      previousMs: 600,
    });
    advance(400);
    await recorder.pause();
    assert.deepEqual(saved()[0]?.segments, [
      { startedAt: 0, endedAt: 600 },
      { startedAt: 1_000, endedAt: 1_400 },
    ]);
    assert.equal(recorder.summaries()[0]?.recordedMs, 1_000);
  });

  it('finishes a meeting being recorded, and never resumes it again', async () => {
    const { recorder, advance, saved } = setup();
    await recorder.load();
    const id = await recorder.start('Standup');
    advance(30_000);
    await recorder.finish(id);

    assert.deepEqual(recorder.state(), { status: 'idle' });
    assert.deepEqual(saved()[0], {
      id,
      title: 'Standup',
      segments: [{ startedAt: 1_000, endedAt: 31_000 }],
      finishedAt: 31_000,
      transcript: [],
      summary: null,
    });
    assert.equal(recorder.summaries()[0]?.status, 'finished');
    await assert.rejects(recorder.resume(id), /cannot be resumed/);
  });

  it('stays idle and reports it when the first save fails', async () => {
    let changes = 0;
    const recorder = createRecorder({
      store: {
        load: async () => [],
        save: async () => {
          throw new Error('ENOSPC');
        },
        flush: async () => {},
      },
      now: () => 0,
      newId: () => 'x',
      every: () => () => {},
      onChange: () => {
        changes += 1;
      },
    });
    await recorder.load();
    await assert.rejects(recorder.start('A'), /ENOSPC/);
    assert.deepEqual(recorder.state(), { status: 'idle' });
    assert.deepEqual(recorder.summaries(), []);
    assert.ok(changes > 0);
  });

  it('starts no heartbeat when the meeting was paused while it was being saved', async () => {
    const saves: Array<() => void> = [];
    let ticking = false;
    const recorder = createRecorder({
      store: {
        load: async () => [],
        save: () =>
          new Promise<void>((resolve) => {
            saves.push(resolve);
          }),
        flush: async () => {},
      },
      now: () => 0,
      newId: () => 'x',
      every: () => {
        ticking = true;
        return () => {
          ticking = false;
        };
      },
      onChange: () => {},
    });
    await recorder.load();
    const starting = recorder.start('A');
    const pausing = recorder.pause();
    for (const finish of saves) {
      finish();
    }
    await starting;
    await pausing;
    assert.deepEqual(recorder.state(), { status: 'idle' });
    assert.equal(ticking, false);
  });

  it('keeps changes to other meetings when a start fails to save', async () => {
    const earlier: Meeting = {
      ...startMeeting('a', 'A', 0),
      finishedAt: 10,
      transcript: [{ speaker: 'me', startMs: 0, endMs: 1, text: 'Hi.' }],
    };
    let failFirst: (error: Error) => void = () => {};
    let saves = 0;
    const recorder = createRecorder({
      store: {
        load: async () => [earlier],
        save: () => {
          saves += 1;
          return saves === 1
            ? new Promise<void>((_resolve, reject) => {
                failFirst = reject;
              })
            : Promise.resolve();
        },
        flush: async () => {},
      },
      now: () => 100,
      newId: () => 'b',
      every: () => () => {},
      onChange: () => {},
    });
    await recorder.load();
    const starting = recorder.start('B');
    await recorder.saveSummary('a', 'We met.');
    failFirst(new Error('ENOSPC'));
    await assert.rejects(starting, /ENOSPC/);
    assert.deepEqual(
      recorder.summaries().map((meeting) => meeting.id),
      ['a'],
    );
    assert.equal(recorder.transcriptOf('a')?.summary, 'We met.');
  });

  it('tells the user while recent recording can’t be saved, and clears it once it can', async () => {
    let failing = false;
    let tick = () => {};
    const recorder = createRecorder({
      store: {
        load: async () => [],
        save: async () => {
          if (failing) {
            throw new Error('ENOSPC');
          }
        },
        flush: async () => {},
      },
      now: () => 0,
      newId: () => 'x',
      every: (callback) => {
        tick = callback;
        return () => {};
      },
      onChange: () => {},
    });
    await recorder.load();
    await recorder.start('A');
    assert.equal(recorder.detail('x').problem, null);
    failing = true;
    tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(recorder.detail('x').problem ?? '', /couldn’t be saved/);
    failing = false;
    tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(recorder.detail('x').problem, null);
  });

  it('records one meeting at a time', async () => {
    const { recorder } = setup();
    await recorder.load();
    await recorder.start('A');
    await assert.rejects(recorder.start('B'), /already being recorded/);
    await assert.rejects(recorder.resume('m1'), /already being recorded/);
  });

  it('never records over meetings that could not be loaded', async () => {
    const recorder = createRecorder({
      store: {
        load: async () => {
          throw new Error('Error while decrypting the ciphertext');
        },
        save: async () => {
          throw new Error('should not save');
        },
        flush: async () => {},
      },
      now: () => 0,
      newId: () => 'x',
      every: () => () => {},
      onChange: () => {},
    });
    await assert.rejects(recorder.load(), /decrypting/);
    await assert.rejects(recorder.start('A'), /could not be read/);
  });

  it('lists the newest meeting first and marks the one being recorded', async () => {
    const { recorder, advance } = setup([
      {
        id: 'old',
        title: 'Old',
        segments: [{ startedAt: 0, endedAt: 10 }],
        finishedAt: null,
        transcript: [],
        summary: null,
      },
    ]);
    await recorder.load();
    advance(5_000);
    const id = await recorder.start('New');
    assert.deepEqual(
      recorder.summaries().map((meeting) => [meeting.id, meeting.status]),
      [
        [id, 'recording'],
        ['old', 'paused'],
      ],
    );
  });
});
