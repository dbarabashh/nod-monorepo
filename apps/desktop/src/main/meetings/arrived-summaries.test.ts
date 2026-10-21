import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  appendTranscript,
  finishMeeting,
  setSummary,
  startMeeting,
  type Meeting,
  type TranscriptLine,
} from '@nod/core/meetings';
import { createArrivedSummaries } from './arrived-summaries.ts';

const hour = 60 * 60_000;

function line(id: string, startMs: number): TranscriptLine {
  return {
    id,
    speaker: 'others',
    startMs,
    endMs: startMs + 1_000,
    text: `line ${id}`,
  };
}

function finished(id: string, at: number): Meeting {
  const started = startMeeting(id, 'Meeting on Monday', at - 60_000);
  return finishMeeting(appendTranscript(started, [line('l1', 0)]), at);
}

function setUp() {
  const clock = 240 * hour;
  const meetings = new Map<string, Meeting>();
  const calls: Array<[string, string | null]> = [];
  const delays: number[] = [];
  const timers = new Map<number, () => void>();
  let timer = 0;
  let recording = false;
  let modelInstalled = true;
  let failing = false;
  let whileRunning = (_id: string) => {};
  let busyElsewhere = false;
  const summaries = createArrivedSummaries({
    meeting: (id) => meetings.get(id),
    summarize: async (id, expected) => {
      calls.push([id, expected]);
      if (failing) {
        throw new Error('model crashed');
      }
      if (busyElsewhere) {
        return false;
      }
      const lines = meetings.get(id)?.transcript.length ?? 0;
      whileRunning(id);
      const current = meetings.get(id);
      if (!modelInstalled || !current || current.summary !== expected) {
        return false;
      }
      meetings.set(id, setSummary(current, `Summary of ${lines}`, 'Plan'));
      return true;
    },
    recording: () => recording,
    now: () => clock,
    later: (ms, run) => {
      delays.push(ms);
      const key = (timer += 1);
      timers.set(key, run);
      return () => timers.delete(key);
    },
  });
  const fire = async () => {
    const due = [...timers.values()];
    timers.clear();
    for (const run of due) {
      run();
    }
    await summaries.settled();
  };
  return {
    meetings,
    calls,
    delays,
    timers,
    summaries,
    fire,
    clock,
    setRecording: (value: boolean) => {
      recording = value;
    },
    setModelInstalled: (value: boolean) => {
      modelInstalled = value;
    },
    setFailing: (value: boolean) => {
      failing = value;
    },
    setBusyElsewhere: (value: boolean) => {
      busyElsewhere = value;
    },
    whileRunning: (run: (id: string) => void) => {
      whileRunning = run;
    },
  };
}

describe('summaries of meetings recorded on another device', () => {
  it('writes one 30 seconds after the transcript stopped changing', async () => {
    const { meetings, calls, delays, timers, summaries, fire, clock } = setUp();
    meetings.set('a', finished('a', clock - 5_000));

    summaries.arrived('a');
    summaries.arrived('a');
    assert.equal(timers.size, 1);
    assert.deepEqual(delays, [30_000, 30_000]);
    assert.deepEqual(calls, []);

    await fire();
    assert.deepEqual(calls, [['a', null]]);
    assert.equal(meetings.get('a')?.summary, 'Summary of 1');

    summaries.arrived('a');
    await fire();
    assert.equal(calls.length, 1);
  });

  it('leaves alone meetings still recording, empty, summarized, edited or a day old', async () => {
    const { meetings, calls, summaries, fire, clock } = setUp();
    meetings.set('recording', startMeeting('recording', 'Live', clock));
    meetings.set(
      'empty',
      finishMeeting(startMeeting('empty', 'Empty', clock - 1_000), clock),
    );
    meetings.set(
      'summarized',
      setSummary(finished('summarized', clock), 'Done.', 'Plan'),
    );
    meetings.set('edited', {
      ...finished('edited', clock),
      summaryEdited: true,
    });
    meetings.set('old', finished('old', clock - 24 * hour));

    summaries.scan([...meetings.keys()]);
    await fire();

    assert.deepEqual(calls, []);
  });

  it('still writes one for a meeting finished 23 hours ago', async () => {
    const { meetings, calls, summaries, fire, clock } = setUp();
    meetings.set('a', finished('a', clock - 23 * hour));

    summaries.scan(['a']);
    await fire();

    assert.deepEqual(calls, [['a', null]]);
  });

  it('skips a meeting summarized elsewhere while it waited', async () => {
    const { meetings, calls, summaries, fire, clock } = setUp();
    const meeting = finished('a', clock);
    meetings.set('a', meeting);
    summaries.arrived('a');

    meetings.set('a', setSummary(meeting, 'Done.', 'Plan'));
    await fire();

    assert.deepEqual(calls, []);
  });

  it('waits while this computer records', async () => {
    const { meetings, calls, timers, summaries, fire, clock, setRecording } =
      setUp();
    meetings.set('a', finished('a', clock));
    setRecording(true);
    summaries.arrived('a');

    await fire();
    assert.deepEqual(calls, []);
    assert.equal(timers.size, 1);

    setRecording(false);
    await fire();
    assert.deepEqual(calls, [['a', null]]);
  });

  it('writes it again once when lines arrive after the summary', async () => {
    const { meetings, calls, summaries, fire, clock } = setUp();
    meetings.set('a', finished('a', clock));
    summaries.arrived('a');
    await fire();

    const summarized = meetings.get('a');
    assert.ok(summarized);
    meetings.set('a', appendTranscript(summarized, [line('l2', 5_000)]));
    summaries.arrived('a');
    await fire();
    assert.deepEqual(calls, [
      ['a', null],
      ['a', 'Summary of 1'],
    ]);
    assert.equal(meetings.get('a')?.summary, 'Summary of 2');

    const again = meetings.get('a');
    assert.ok(again);
    meetings.set('a', appendTranscript(again, [line('l3', 9_000)]));
    summaries.arrived('a');
    await fire();
    assert.equal(calls.length, 2);
  });

  it('doesn’t rewrite a summary another device wrote', async () => {
    const { meetings, calls, summaries, fire, clock } = setUp();
    const meeting = setSummary(finished('a', clock), 'Theirs.', 'Plan');
    meetings.set('a', appendTranscript(meeting, [line('l2', 5_000)]));

    summaries.arrived('a');
    await fire();

    assert.deepEqual(calls, []);
  });

  it('tries again once a summary model is installed', async () => {
    const { meetings, calls, summaries, fire, clock, setModelInstalled } =
      setUp();
    meetings.set('a', finished('a', clock));
    setModelInstalled(false);
    summaries.arrived('a');
    await fire();
    assert.equal(meetings.get('a')?.summary, null);

    setModelInstalled(true);
    summaries.scan(['a']);
    await fire();
    assert.deepEqual(calls, [
      ['a', null],
      ['a', null],
    ]);
    assert.equal(meetings.get('a')?.summary, 'Summary of 1');
  });

  it('goes on with the next meeting when one fails, without retrying it', async () => {
    const { meetings, calls, summaries, fire, clock, setFailing } = setUp();
    meetings.set('a', finished('a', clock));
    meetings.set('b', finished('b', clock));
    setFailing(true);
    summaries.arrived('a');
    await fire();

    setFailing(false);
    summaries.scan(['a', 'b']);
    await fire();

    assert.deepEqual(calls, [
      ['a', null],
      ['b', null],
    ]);
  });

  it('writes one summary at a time', async () => {
    const { meetings, clock } = setUp();
    let running = 0;
    let most = 0;
    const order: string[] = [];
    const timers: Array<() => void> = [];
    const serial = createArrivedSummaries({
      meeting: (id) => meetings.get(id),
      summarize: async (id) => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        order.push(id);
        running -= 1;
        return true;
      },
      recording: () => false,
      now: () => clock,
      later: (_ms, run) => {
        timers.push(run);
        return () => {};
      },
    });
    meetings.set('a', finished('a', clock));
    meetings.set('b', finished('b', clock));
    serial.scan(['a', 'b']);
    for (const run of timers) {
      run();
    }
    await serial.settled();

    assert.equal(most, 1);
    assert.deepEqual(order, ['a', 'b']);
  });

  it('never takes a summary another device wrote meanwhile for its own', async () => {
    const { meetings, calls, summaries, fire, clock, whileRunning } = setUp();
    meetings.set('a', finished('a', clock));
    whileRunning((id) => {
      const current = meetings.get(id);
      assert.ok(current);
      meetings.set(id, setSummary(current, 'Theirs.', 'Plan'));
      whileRunning(() => {});
    });
    summaries.arrived('a');
    await fire();
    assert.equal(meetings.get('a')?.summary, 'Theirs.');

    const theirs = meetings.get('a');
    assert.ok(theirs);
    meetings.set('a', appendTranscript(theirs, [line('l2', 5_000)]));
    summaries.arrived('a');
    await fire();

    assert.deepEqual(calls, [['a', null]]);
  });

  it('writes it again when lines arrive while the model runs', async () => {
    const { meetings, calls, summaries, fire, clock, whileRunning } = setUp();
    meetings.set('a', finished('a', clock));
    whileRunning((id) => {
      const current = meetings.get(id);
      assert.ok(current);
      meetings.set(id, appendTranscript(current, [line('l2', 5_000)]));
      summaries.arrived(id);
      whileRunning(() => {});
    });
    summaries.arrived('a');
    await fire();
    assert.equal(meetings.get('a')?.summary, 'Summary of 1');

    await fire();
    assert.deepEqual(calls, [
      ['a', null],
      ['a', 'Summary of 1'],
    ]);
    assert.equal(meetings.get('a')?.summary, 'Summary of 2');
  });

  it('doesn’t push back a meeting that already waits when it scans again', async () => {
    const { meetings, delays, summaries, clock } = setUp();
    meetings.set('a', finished('a', clock));

    summaries.scan(['a']);
    summaries.scan(['a']);
    summaries.scan(['a']);

    assert.deepEqual(delays, [30_000]);
  });

  it('drops a waiting job once another device’s summary arrives', async () => {
    const { meetings, calls, summaries, clock, whileRunning, fire } = setUp();
    meetings.set('a', finished('a', clock));
    meetings.set('b', finished('b', clock));
    whileRunning((id) => {
      if (id === 'a') {
        const b = meetings.get('b');
        assert.ok(b);
        meetings.set('b', setSummary(b, 'Theirs.', 'Plan'));
      }
    });
    summaries.scan(['a', 'b']);

    await fire();

    assert.deepEqual(calls, [['a', null]]);
  });

  it('keeps its one rewrite when a summary the user asked for was running', async () => {
    const { meetings, calls, summaries, fire, clock, setBusyElsewhere } =
      setUp();
    meetings.set('a', finished('a', clock));
    summaries.arrived('a');
    await fire();
    const summarized = meetings.get('a');
    assert.ok(summarized);
    meetings.set('a', appendTranscript(summarized, [line('l2', 5_000)]));

    setBusyElsewhere(true);
    summaries.arrived('a');
    await fire();
    setBusyElsewhere(false);
    summaries.arrived('a');
    await fire();

    assert.deepEqual(calls, [
      ['a', null],
      ['a', 'Summary of 1'],
      ['a', 'Summary of 1'],
    ]);
    assert.equal(meetings.get('a')?.summary, 'Summary of 2');
  });
});
