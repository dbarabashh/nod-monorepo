import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import * as Automerge from '@automerge/automerge';
import {
  appendTranscript,
  createDocument,
  finishMeeting,
  importedDocument,
  readDocument,
  readMeetingExport,
  sameDocument,
  startMeeting,
  updateDocument,
  type Meeting,
} from '@nod/core/meetings';
import { useTempDir } from '../testing/temp-dir.ts';
import { createRecorder } from './recorder.ts';
import { createMeetingStore, type Cipher } from './store.ts';

const plain: Cipher = {
  encrypt: (data) => Buffer.from(data),
  decrypt: (data) => data,
};

describe('recorder and store together', () => {
  const dir = useTempDir('recorder-store-');

  it('keeps a remote line and a local line saved while the merge was writing', async () => {
    const directory = join(dir(), 'meetings');
    const store = createMeetingStore({ directory, cipher: async () => plain });
    let tick = () => {};
    const recorder = createRecorder({
      store,
      now: () => 1_000,
      newId: () => 'm1',
      every: (callback) => {
        tick = callback;
        return () => {};
      },
      onChange: () => {},
    });
    await recorder.load();
    await recorder.start('Sync while recording');
    await recorder.appendLines('m1', [
      { id: 'a', speaker: 'me', startMs: 0, endMs: 500, text: 'First.' },
    ]);

    const base = recorder.transcriptOf('m1');
    const shared = store.document('m1');
    assert.ok(base && shared);
    const remote = updateDocument(
      Automerge.clone(shared),
      base,
      appendTranscript(base, [
        {
          id: 'r',
          speaker: 'others',
          startMs: 600,
          endMs: 900,
          text: 'From the phone.',
        },
      ]),
    );

    const merged = store.merge('m1', remote);
    if (merged.state) {
      recorder.applyRemote(merged.state);
    }
    const local = recorder.appendLines('m1', [
      {
        id: 'l',
        speaker: 'me',
        startMs: 1_000,
        endMs: 1_500,
        text: 'Said here.',
      },
    ]);
    tick();
    await Promise.all([merged.written, local]);
    await store.flush();

    const reopened = createMeetingStore({
      directory,
      cipher: async () => plain,
    });
    const [saved] = await reopened.load();
    assert.deepEqual(
      saved?.transcript.map((line) => line.id),
      ['a', 'r', 'l'],
    );
    assert.deepEqual(
      recorder.transcriptOf('m1')?.transcript.map((line) => line.id),
      ['a', 'r', 'l'],
    );
  });

  it('keeps a summary line from the phone through two saves from an editor that never showed it', async () => {
    const directory = join(dir(), 'meetings');
    const store = createMeetingStore({ directory, cipher: async () => plain });
    const recorder = createRecorder({
      store,
      now: () => 1_000,
      newId: () => 'm1',
      every: () => () => {},
      onChange: () => {},
    });
    await recorder.load();
    await recorder.start('Planning');
    await recorder.finish('m1');
    await recorder.saveSummary('m1', 'Ship sharing first.\nTeams next.', '');
    const opened = recorder.detail('m1').version;
    assert.ok(opened);

    const base = recorder.transcriptOf('m1');
    const shared = store.document('m1');
    assert.ok(base && shared);
    const merged = store.merge(
      'm1',
      updateDocument(Automerge.clone(shared), base, {
        ...base,
        summary: 'Ship sharing first.\nTest on two machines.\nTeams next.',
      }),
    );
    if (merged.state) {
      recorder.applyRemote(merged.state);
    }
    await merged.written;

    const first = await recorder.editSummary(
      'm1',
      'Ship sharing first.\nTeams next.\nCheck the clock.',
      opened,
    );
    assert.equal(
      recorder.detail('m1').summary,
      'Ship sharing first.\nTest on two machines.\nTeams next.\nCheck the clock.',
    );
    await recorder.editSummary(
      'm1',
      'Ship sharing first.\nTeams next.\nCheck the clock twice.',
      first,
    );
    await store.flush();

    const expected =
      'Ship sharing first.\nTest on two machines.\nTeams next.\nCheck the clock twice.';
    assert.equal(recorder.detail('m1').summary, expected);
    const [saved] = await createMeetingStore({
      directory,
      cipher: async () => plain,
    }).load();
    assert.equal(saved?.summary, expected);
    assert.equal(saved?.summaryEdited, true);
  });

  it('refuses remote copies until saved meetings were read', () => {
    const store = createMeetingStore({
      directory: join(dir(), 'never-loaded'),
      cipher: async () => plain,
    });
    const early = store.merge('m1', createDocument(startMeeting('m1', 'A', 0)));
    assert.equal(early.state, null);
    assert.deepEqual(store.ids(), []);
  });
});

describe('importing meetings', () => {
  const dir = useTempDir('import-');

  function imported(id: string, title: string): Meeting {
    const meeting = finishMeeting(startMeeting(id, title, 5_000), 9_000);
    return { ...meeting, summary: 'Notes', summaryEdited: true };
  }

  async function open(directory: string, cipher: Cipher = plain) {
    const store = createMeetingStore({ directory, cipher: async () => cipher });
    const recorder = createRecorder({
      store,
      now: () => 50_000,
      newId: () => 'new',
      every: () => () => {},
      onChange: () => {},
    });
    await recorder.load();
    return { store, recorder };
  }

  it('leaves meetings already here alone and brings deleted ones back as new', async () => {
    const directory = join(dir(), 'meetings');
    const { store, recorder } = await open(directory);
    assert.deepEqual(
      await recorder.importMeetings([
        imported('imported-a', 'Kept'),
        imported('imported-b', 'Renamed later'),
        imported('imported-c', 'Deleted later'),
      ]),
      { added: 3, present: 0, failed: 0 },
    );
    await recorder.rename('imported-b', 'My name');
    await recorder.remove('imported-c');

    assert.deepEqual(
      await recorder.importMeetings([
        imported('imported-a', 'Kept'),
        imported('imported-b', 'Renamed later'),
        imported('imported-c', 'Deleted later'),
        imported('imported-d', 'New in this file'),
      ]),
      { added: 2, present: 2, failed: 0 },
    );
    assert.deepEqual(
      await recorder.importMeetings([imported('imported-c', 'Deleted later')]),
      { added: 0, present: 1, failed: 0 },
    );
    await store.flush();

    const reopened = await open(directory);
    assert.deepEqual(
      (await reopened.recorder.list())
        .map((meeting) => [meeting.id, meeting.title])
        .sort(),
      [
        ['imported-a', 'Kept'],
        ['imported-b', 'My name'],
        ['imported-c_2', 'Deleted later'],
        ['imported-d', 'New in this file'],
      ],
    );
    assert.equal(reopened.store.isDeleted('imported-c'), true);
  });

  it('brings a meeting back each time it is deleted and imported again', async () => {
    const { recorder } = await open(join(dir(), 'meetings'));
    const meeting = imported('imported-a', 'Again');
    await recorder.importMeetings([meeting]);
    await recorder.remove('imported-a');
    await recorder.importMeetings([meeting]);
    await recorder.remove('imported-a_2');
    assert.deepEqual(await recorder.importMeetings([meeting]), {
      added: 1,
      present: 0,
      failed: 0,
    });
    assert.deepEqual(
      recorder.summaries().map((summary) => summary.id),
      ['imported-a_3'],
    );
  });

  it('counts a meeting it could not save and does not list it', async () => {
    const directory = join(dir(), 'meetings');
    const { recorder } = await open(directory);
    const result = await recorder.importMeetings([
      imported('imported-a', 'Saved'),
      imported('bad/id', 'Not a valid id'),
    ]);
    assert.deepEqual(result, { added: 1, present: 0, failed: 1 });
    assert.deepEqual(
      recorder.summaries().map((meeting) => meeting.title),
      ['Saved'],
    );
  });

  it('builds the same history for the same meeting on every device', async () => {
    const meeting = imported('imported-a', 'Shared');
    const here = await open(join(dir(), 'here'));
    const there = await open(join(dir(), 'there'));
    await here.store.importMeeting(meeting);
    await there.store.importMeeting(meeting);
    const a = here.store.document('imported-a');
    const b = there.store.document('imported-a');
    assert.ok(a && b);
    assert.equal(sameDocument(a, b), true);
  });

  it('keeps a copy that arrived from another device', async () => {
    const meeting = imported('imported-a', 'From the file');
    const { store } = await open(join(dir(), 'meetings'));
    const remote = updateDocument(importedDocument(meeting), meeting, {
      ...meeting,
      summary: 'Edited on the phone',
    });
    await store.merge('imported-a', remote).written;
    await store.importMeeting(meeting);
    const kept = store.document('imported-a');
    assert.ok(kept);
    assert.deepEqual(readDocument(kept), {
      kind: 'meeting',
      id: 'imported-a',
      meeting: { ...meeting, summary: 'Edited on the phone' },
    });
  });

  it('imports a meeting again after its write failed', async () => {
    const directory = join(dir(), 'meetings');
    let full = true;
    const { store, recorder } = await open(directory, {
      ...plain,
      encrypt: (data, context) => {
        if (full) {
          throw new Error('ENOSPC');
        }
        return plain.encrypt(data, context);
      },
    });
    const meeting = imported('imported-a', 'Saved on retry');
    assert.deepEqual(await recorder.importMeetings([meeting]), {
      added: 0,
      present: 0,
      failed: 1,
    });
    assert.deepEqual(recorder.summaries(), []);

    full = false;
    assert.deepEqual(await recorder.importMeetings([meeting]), {
      added: 1,
      present: 0,
      failed: 0,
    });
    await store.flush();
    const reopened = await open(directory);
    assert.deepEqual(
      (await reopened.recorder.list()).map((saved) => saved.title),
      ['Saved on retry'],
    );
  });

  it('imports an exported file end to end', async () => {
    const parsed = readMeetingExport({
      format: 'nod-meetings',
      version: 1,
      meetings: [
        {
          id: 'cloud-1',
          title: 'Planning',
          startedAt: '2026-09-01T10:00:00Z',
          endedAt: '2026-09-01T10:30:00Z',
          summary: 'Plan',
          transcript: [
            { speaker: 'me', startMs: 0, endMs: 900, text: 'Hello.' },
          ],
        },
      ],
    });
    assert.ok(parsed);
    const directory = join(dir(), 'meetings');
    const { store, recorder } = await open(directory);
    await recorder.importMeetings(parsed.meetings);
    await store.flush();

    const reopened = await open(directory);
    const { version, ...detail } = reopened.recorder.detail('imported-cloud-1');
    assert.match(version ?? '', /^[0-9a-f]{64}$/);
    assert.deepEqual(detail, {
      id: 'imported-cloud-1',
      transcript: [
        {
          id: 'imported-cloud-1-00000',
          speaker: 'me',
          startMs: 0,
          endMs: 900,
          text: 'Hello.',
        },
      ],
      summary: 'Plan',
      summaryEdited: false,
      summaryStatus: 'idle',
      problem: null,
      sharedAs: [],
    });
    assert.deepEqual(await reopened.recorder.list(), [
      {
        id: 'imported-cloud-1',
        title: 'Planning',
        startedAt: 1788256800000,
        recordedMs: 1_800_000,
        folder: null,
        status: 'finished',
        contentVersion: '0:',
      },
    ]);
  });
});
