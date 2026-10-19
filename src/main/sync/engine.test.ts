import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  appendTranscript,
  editSummary,
  loadDocument,
  readDocument,
  setSummary,
  startMeeting,
  type DocumentState,
} from '../../core/meetings/index.ts';
import { meetingContext, meetingPath } from '../../core/sync/index.ts';
import { createMeetingStore, type Cipher } from '../meetings/store.ts';
import { fileKeyOf, open, seal } from '../../core/crypto/index.ts';
import { useTempDir } from '../testing/temp-dir.ts';
import { createSyncEngine } from '../../core/sync/index.ts';
import { createFolderTransport } from './folder-transport.ts';
import type { Transport } from '../../core/sync/index.ts';

const plainCipher: Cipher = {
  encrypt: (plain) => Buffer.from(plain),
  decrypt: (data) => data,
};

const meeting = setSummary(
  appendTranscript(startMeeting('m1', 'Launch', 1_000), [
    {
      id: 'l1',
      speaker: 'others',
      startMs: 0,
      endMs: 900,
      text: 'Jon ships Friday.',
    },
  ]),
  'Jon ships the onboarding on Friday.',
);

function counting(transport: Transport) {
  let writes = 0;
  return {
    transport: {
      ...transport,
      write: (path: string, data: Uint8Array) => {
        writes += 1;
        return transport.write(path, data);
      },
    },
    writes: () => writes,
  };
}

describe('sync engine', () => {
  const dir = useTempDir('sync-engine-');
  const vaultKey = randomBytes(32);

  async function device(name: string, key = vaultKey) {
    const store = createMeetingStore({
      directory: join(dir(), name),
      cipher: async () => plainCipher,
    });
    await store.load();
    const received: DocumentState[] = [];
    const shared = counting(createFolderTransport(join(dir(), 'shared')));
    const engine = createSyncEngine({
      transport: shared.transport,
      vault: { id: 'vault-1', key, deviceId: name },
      store,
      onRemote: (state) => received.push(state),
      now: () => 42,
    });
    return { store, engine, received, writes: shared.writes };
  }

  it('brings a meeting to the other device and merges edits made on both', async () => {
    const laptop = await device('laptop');
    const phone = await device('phone');
    await laptop.store.save(meeting);
    await laptop.engine.sync();
    await phone.engine.sync();
    assert.deepEqual(phone.received, [{ kind: 'meeting', id: 'm1', meeting }]);

    await laptop.store.save(
      editSummary(meeting, 'John ships the onboarding on Friday.'),
    );
    await phone.store.save({
      ...editSummary(
        meeting,
        'Jon ships the onboarding on Friday. Anna writes notes.',
      ),
      title: 'Launch sync',
    });
    await laptop.engine.sync();
    await phone.engine.sync();
    await laptop.engine.sync();

    for (const side of [laptop, phone]) {
      const state = readDocument(side.store.document('m1') ?? loadFail());
      assert.equal(state?.kind, 'meeting');
      if (state?.kind === 'meeting') {
        assert.equal(
          state.meeting.summary,
          'John ships the onboarding on Friday. Anna writes notes.',
        );
        assert.equal(state.meeting.title, 'Launch sync');
      }
    }
    assert.equal(laptop.engine.status().devices, 1);
    assert.equal(laptop.engine.status().lastSyncedAt, 42);
  });

  it('stops writing once both devices have the same meetings', async () => {
    const laptop = await device('laptop');
    const phone = await device('phone');
    await laptop.store.save(meeting);
    for (let round = 0; round < 3; round += 1) {
      await laptop.engine.sync();
      await phone.engine.sync();
    }
    const settled = laptop.writes() + phone.writes();
    await laptop.engine.sync();
    await phone.engine.sync();
    assert.equal(laptop.writes() + phone.writes(), settled);
  });

  it('spreads a deletion and leaves none of the text in any published file', async () => {
    const laptop = await device('laptop');
    const phone = await device('phone');
    await laptop.store.save(meeting);
    await laptop.engine.sync();
    await phone.engine.sync();

    await laptop.store.remove('m1', 9_000);
    await laptop.engine.sync();
    await phone.engine.sync();

    assert.deepEqual(phone.received.at(-1), {
      kind: 'deleted',
      id: 'm1',
      deletedAt: 9_000,
    });
    const folder = createFolderTransport(join(dir(), 'shared'));
    for (const name of ['laptop', 'phone']) {
      const sealed = await folder.read(meetingPath(name, 'm1'), 1_000_000);
      assert.ok(sealed);
      const document = loadDocument(
        open(
          fileKeyOf(vaultKey),
          sealed,
          meetingContext('vault-1', name, 'm1'),
        ),
      );
      assert.deepEqual(readDocument(document ?? loadFail()), {
        kind: 'deleted',
        id: 'm1',
        deletedAt: 9_000,
      });
      assert.equal(Buffer.from(sealed).includes('Jon'), false);
      assert.throws(() =>
        open(vaultKey, sealed, meetingContext('vault-1', name, 'm1')),
      );
    }
  });

  it('shows a meeting restored over a damaged file once it is written', async () => {
    const laptop = await device('laptop');
    await laptop.store.save(meeting);
    await laptop.engine.sync();
    await mkdir(join(dir(), 'phone'), { recursive: true });
    await writeFile(join(dir(), 'phone', 'm1.bin'), 'not a meeting');
    const phone = await device('phone');

    await phone.engine.sync();

    assert.deepEqual(phone.received, [{ kind: 'meeting', id: 'm1', meeting }]);
  });

  it('reports a file it cannot open and still takes the others', async () => {
    const laptop = await device('laptop');
    const phone = await device('phone');
    await laptop.store.save(meeting);
    await laptop.engine.sync();
    await createFolderTransport(join(dir(), 'shared')).write(
      meetingPath('stranger', 'm9'),
      seal(
        randomBytes(32),
        Buffer.from('x'),
        meetingContext('vault-1', 'stranger', 'm9'),
      ),
    );

    await phone.engine.sync();

    assert.deepEqual(
      phone.received.map((state) => state.id),
      ['m1'],
    );
    assert.match(phone.engine.status().error ?? '', /could not be opened/);
    assert.equal(phone.engine.status().lastSyncedAt, null);
  });
});

function loadFail(): never {
  throw new Error('missing document');
}
