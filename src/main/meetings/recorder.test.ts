import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  finishMeeting,
  startMeeting,
  type Meeting,
} from '../../core/meetings/index.ts';
import { createRecorder, type RecorderStore } from './recorder.ts';

const noImports: Pick<RecorderStore, 'isDeleted' | 'importMeeting'> = {
  isDeleted: () => false,
  importMeeting: async () => {},
};

function setup(initial: Meeting[] = []) {
  let time = 1_000;
  const saved = new Map(initial.map((meeting) => [meeting.id, meeting]));
  const deleted = new Set<string>();
  let tick = () => {};
  let ticking = false;
  let ids = 0;
  const store: RecorderStore = {
    load: async () => [...saved.values()],
    save: async (meeting) => {
      saved.set(meeting.id, meeting);
    },
    remove: async (id) => {
      saved.delete(id);
      deleted.add(id);
    },
    isDeleted: (id) => deleted.has(id),
    importMeeting: async (meeting) => {
      saved.set(meeting.id, meeting);
    },
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
    saved: () => [...saved.values()],
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
        summaryEdited: false,
        titleEdited: false,
        generatedTitle: null,
        folder: null,
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
      summaryEdited: false,
      titleEdited: false,
      generatedTitle: null,
      folder: null,
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
      summaryEdited: false,
      titleEdited: false,
      generatedTitle: null,
      folder: null,
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
        remove: async () => {},
        ...noImports,
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
        remove: async () => {},
        ...noImports,
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
      transcript: [
        { id: 'me-0', speaker: 'me', startMs: 0, endMs: 1, text: 'Hi.' },
      ],
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
        remove: async () => {},
        ...noImports,
      },
      now: () => 100,
      newId: () => 'b',
      every: () => () => {},
      onChange: () => {},
    });
    await recorder.load();
    const starting = recorder.start('B');
    await recorder.saveSummary('a', 'We met.', '');
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
        remove: async () => {},
        ...noImports,
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

  it('saves a corrected summary and line, and tells windows to reload them', async () => {
    const { recorder, saved } = setup();
    await recorder.load();
    const id = await recorder.start('A');
    await recorder.appendLines(id, [
      {
        id: 'others-500',
        speaker: 'others',
        startMs: 500,
        endMs: 900,
        text: 'Jon here.',
      },
    ]);
    await recorder.finish(id);
    await recorder.saveSummary(id, 'Met Jon.', '');
    const before = recorder.summaries()[0]?.contentVersion;

    await recorder.editSummary(id, 'Met Ann.');
    const afterSummary = recorder.summaries()[0]?.contentVersion;
    await recorder.editLine(id, 'others-500', 'Ann here.');

    assert.notEqual(afterSummary, before);
    assert.notEqual(recorder.summaries()[0]?.contentVersion, afterSummary);
    assert.equal(saved()[0]?.summary, 'Met Ann.');
    assert.equal(saved()[0]?.summaryEdited, true);
    assert.equal(saved()[0]?.transcript[0]?.text, 'Ann here.');
  });

  it('keeps a summary corrected while a new one was being written', async () => {
    const { recorder } = setup();
    await recorder.load();
    const id = await recorder.start('A');
    await recorder.finish(id);
    await recorder.saveSummary(id, 'Met Jon.', '');
    await recorder.editSummary(id, 'Met John.');

    await recorder.saveSummary(id, 'A newer summary from the model.', '');

    assert.equal(recorder.transcriptOf(id)?.summary, 'Met John.');
    assert.equal(recorder.transcriptOf(id)?.summaryEdited, true);
  });

  it('leaves the content version alone while only the clock moves', async () => {
    const { recorder, advance, tick } = setup();
    await recorder.load();
    await recorder.start('A');
    const before = recorder.summaries()[0]?.contentVersion;
    advance(5_000);
    tick();
    assert.equal(recorder.summaries()[0]?.contentVersion, before);
  });

  it('deletes a meeting, but never the one being recorded', async () => {
    const { recorder, saved } = setup();
    await recorder.load();
    const first = await recorder.start('A');
    await recorder.pause();
    const second = await recorder.start('B');

    await assert.rejects(recorder.remove(second), /Pause the recording/);
    await recorder.remove(first);

    assert.deepEqual(
      recorder.summaries().map((meeting) => meeting.id),
      [second],
    );
    assert.deepEqual(
      saved().map((meeting) => meeting.id),
      [second],
    );
  });

  it('shows changes and deletions that arrive from another device', async () => {
    const { recorder } = setup([startMeeting('m1', 'Old title', 0)]);
    await recorder.load();
    const before = recorder.summaries()[0]?.contentVersion;

    recorder.applyRemote({
      kind: 'meeting',
      id: 'm1',
      meeting: {
        ...startMeeting('m1', 'New title', 0),
        summary: 'From the phone.',
      },
    });
    recorder.applyRemote({
      kind: 'meeting',
      id: 'm2',
      meeting: startMeeting('m2', 'Recorded elsewhere', 50),
    });

    assert.equal(recorder.transcriptOf('m1')?.summary, 'From the phone.');
    assert.notEqual(
      recorder.summaries().find((m) => m.id === 'm1')?.contentVersion,
      before,
    );
    assert.deepEqual(
      recorder.summaries().map((meeting) => meeting.title),
      ['Recorded elsewhere', 'New title'],
    );

    recorder.applyRemote({ kind: 'deleted', id: 'm1', deletedAt: 99 });
    assert.deepEqual(
      recorder.summaries().map((meeting) => meeting.id),
      ['m2'],
    );
  });

  it('stops recording a meeting that another device deleted', async () => {
    const { recorder } = setup();
    await recorder.load();
    const id = await recorder.start('A');
    recorder.applyRemote({ kind: 'deleted', id, deletedAt: 5 });
    assert.deepEqual(recorder.state(), { status: 'idle' });
    assert.deepEqual(recorder.summaries(), []);
  });

  it('keeps a meeting renamed by hand when the summary names it later', async () => {
    const { recorder, saved } = setup();
    await recorder.load();
    const id = await recorder.start('Meeting on Oct 19');
    await recorder.finish(id);
    await recorder.rename(id, 'Pricing call');
    await recorder.saveSummary(id, 'We set prices.', 'Model name');
    assert.equal(saved()[0]?.title, 'Pricing call');
    assert.equal(recorder.summaries()[0]?.title, 'Pricing call');
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
        remove: async () => {},
        ...noImports,
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
        summaryEdited: false,
        titleEdited: false,
        generatedTitle: null,
        folder: 'Clients',
      },
    ]);
    await recorder.load();
    advance(5_000);
    const id = await recorder.start('New');
    assert.deepEqual(
      recorder
        .summaries()
        .map((meeting) => [meeting.id, meeting.status, meeting.folder]),
      [
        [id, 'recording', null],
        ['old', 'paused', 'Clients'],
      ],
    );
  });

  it('files a meeting in a folder and takes it out again', async () => {
    const { recorder, saved } = setup([]);
    await recorder.load();
    const id = await recorder.start('Pricing');
    await recorder.moveToFolder(id, ' Clients ');
    assert.equal(saved().at(-1)?.folder, 'Clients');
    await recorder.moveToFolder(id, null);
    assert.equal(saved().at(-1)?.folder, null);
    await assert.rejects(
      recorder.moveToFolder(id, '  '),
      /folder needs a name/,
    );
  });

  it('renames a folder on every meeting in it, and leaves other folders alone', async () => {
    const { recorder, saved } = setup([]);
    await recorder.load();
    const ids: string[] = [];
    for (const title of ['One', 'Two', 'Three']) {
      ids.push(await recorder.start(title));
      await recorder.pause();
    }
    const [first = '', second = '', third = ''] = ids;
    await recorder.moveToFolder(first, 'Clients');
    await recorder.moveToFolder(second, 'Clients');
    await recorder.moveToFolder(third, 'Design');
    const folders = () =>
      Object.fromEntries(
        recorder.summaries().map((meeting) => [meeting.title, meeting.folder]),
      );

    assert.equal(
      await recorder.renameFolder('Clients', ' Customers '),
      'Customers',
    );
    assert.deepEqual(folders(), {
      One: 'Customers',
      Two: 'Customers',
      Three: 'Design',
    });
    assert.equal(
      saved().find((meeting) => meeting.id === second)?.folder,
      'Customers',
    );
    await assert.rejects(
      recorder.renameFolder('Customers', ' '),
      /folder needs a name/,
    );
    assert.equal(folders().One, 'Customers');

    await recorder.removeFolder('Customers');
    assert.deepEqual(folders(), { One: null, Two: null, Three: 'Design' });
    assert.equal(saved().find((meeting) => meeting.id === first)?.folder, null);
  });

  it('moves every meeting it can when one of them can’t be saved, and reports it', async () => {
    const filed = (id: string, title: string): Meeting => ({
      ...startMeeting(id, title, 0),
      folder: 'Clients',
    });
    const disk = new Map([
      ['a', filed('a', 'Alpha')],
      ['b', filed('b', 'Beta')],
      ['c', filed('c', 'Gamma')],
    ]);
    const recorder = createRecorder({
      store: {
        load: async () => [...disk.values()],
        save: async (meeting) => {
          if (meeting.id === 'b') {
            throw new Error('ENOSPC');
          }
          disk.set(meeting.id, meeting);
        },
        remove: async () => {},
        ...noImports,
      },
      now: () => 0,
      newId: () => 'new',
      every: () => () => {},
      onChange: () => {},
    });
    await recorder.load();

    await assert.rejects(
      recorder.renameFolder('Clients', 'Customers'),
      /ENOSPC/,
    );
    assert.equal(disk.get('a')?.folder, 'Customers');
    assert.equal(disk.get('b')?.folder, 'Clients');
    assert.equal(disk.get('c')?.folder, 'Customers');
    assert.deepEqual(
      Object.fromEntries(
        recorder.summaries().map((meeting) => [meeting.id, meeting.folder]),
      ),
      { a: 'Customers', b: 'Clients', c: 'Customers' },
    );
    await assert.rejects(
      recorder.renameFolder('Clients', 'Customers'),
      /ENOSPC/,
    );
  });

  it('deletes the chosen meetings, leaving the one being recorded', async () => {
    const { recorder, saved } = setup([
      finishMeeting(startMeeting('a', 'A', 0), 10),
      finishMeeting(startMeeting('b', 'B', 0), 10),
      finishMeeting(startMeeting('c', 'C', 0), 10),
    ]);
    await recorder.load();
    const live = await recorder.start('Live');

    assert.deepEqual(
      await recorder.removeMany(['a', 'c', 'a', 'unknown', live]),
      { deleted: 2, failed: 1 },
    );
    assert.deepEqual(
      recorder
        .summaries()
        .map((meeting) => meeting.id)
        .sort(),
      ['b', live].sort(),
    );
    assert.deepEqual(
      saved()
        .map((meeting) => meeting.id)
        .sort(),
      ['b', live].sort(),
    );
  });

  it('refuses to delete before saved meetings were read', async () => {
    const { recorder } = setup([startMeeting('a', 'A', 0)]);
    await assert.rejects(recorder.removeMany(['a']), /could not be read/);
  });

  it('keeps deleting the others when one meeting can’t be deleted', async () => {
    const removed: string[] = [];
    const recorder = createRecorder({
      store: {
        load: async () => [
          startMeeting('a', 'A', 0),
          startMeeting('b', 'B', 0),
          startMeeting('c', 'C', 0),
        ],
        save: async () => {},
        remove: async (id) => {
          if (id === 'b') {
            throw new Error('ENOSPC');
          }
          removed.push(id);
        },
        ...noImports,
      },
      now: () => 0,
      newId: () => 'new',
      every: () => () => {},
      onChange: () => {},
    });
    await recorder.load();

    assert.deepEqual(await recorder.removeMany(['a', 'b', 'c']), {
      deleted: 2,
      failed: 1,
    });
    assert.deepEqual(removed, ['a', 'c']);
    assert.deepEqual(
      recorder.summaries().map((meeting) => meeting.id),
      ['b'],
    );
  });

  it('counts a meeting deleted too many times as not imported', async () => {
    const recorder = createRecorder({
      store: {
        load: async () => [],
        save: async () => {},
        remove: async () => {},
        isDeleted: () => true,
        importMeeting: async () => {},
      },
      now: () => 0,
      newId: () => 'new',
      every: () => () => {},
      onChange: () => {},
    });
    await recorder.load();
    assert.deepEqual(
      await recorder.importMeetings([startMeeting('imported-a', 'A', 0)]),
      { added: 0, present: 0, failed: 1 },
    );
  });
});
