import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import * as Automerge from '@automerge/automerge';
import {
  appendTranscript,
  createDocument,
  startMeeting,
  updateDocument,
} from '../../core/meetings/index.ts';
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
