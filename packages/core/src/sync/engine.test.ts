import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { randomKey, vaultIdOf } from '../crypto/index.ts';
import {
  createDocument,
  startMeeting,
  type MeetingDocument,
  type Merged,
} from '../meetings/index.ts';
import { createSyncEngine, type PublishedLog } from './engine.ts';
import { meetingPath } from './layout.ts';
import { countingTransport, createMemoryTransport } from './testing/index.ts';
import { WritesRefused, type Transport } from './transport.ts';

function memoryLog(): PublishedLog & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    get: (id) => entries.get(id),
    set: (id, heads) => {
      entries.set(id, heads);
    },
  };
}

const key = randomKey();
const nothing: Merged = {
  state: null,
  written: Promise.resolve(null),
  kept: false,
};

function engineFor(
  transport: Transport,
  documents: MeetingDocument[],
  publishedLog: PublishedLog,
) {
  const byId = new Map(documents.map((document) => [document.id, document]));
  return createSyncEngine({
    transport,
    vault: { id: vaultIdOf(key), key, deviceId: 'phone' },
    store: {
      ids: () => [...byId.keys()],
      document: (id) => byId.get(id),
      merge: () => nothing,
    },
    onRemote: () => {},
    now: () => 1,
    publishedLog,
  });
}

describe('publishing across launches', () => {
  const planning = createDocument(startMeeting('m-1', 'Planning', 1_000));
  const retro = createDocument(startMeeting('m-2', 'Retro', 2_000));
  const meetings = [planning, retro];

  it('doesn’t write meetings again after a restart when its copies are still there', async () => {
    const relay = countingTransport(createMemoryTransport());
    const log = memoryLog();
    await engineFor(relay.transport, meetings, log).sync();
    assert.equal(relay.writes(), 2);
    assert.equal(log.entries.size, 2);

    await engineFor(relay.transport, meetings, log).sync();

    assert.equal(relay.writes(), 2);
  });

  it('writes again a meeting whose copy is gone from the relay, or that changed', async () => {
    const memory = createMemoryTransport();
    const relay = countingTransport(memory);
    const log = memoryLog();
    await engineFor(relay.transport, meetings, log).sync();
    await memory.remove(meetingPath('phone', 'm-1'));

    await engineFor(
      relay.transport,
      [planning, createDocument(startMeeting('m-2', 'Retro, renamed', 2_000))],
      log,
    ).sync();

    assert.equal(relay.writes(), 4);
  });
});

describe('a relay that refuses writes', () => {
  it('stops writing for the round after the first refusal, and still receives', async () => {
    const memory = createMemoryTransport();
    const fromComputer = createDocument(
      startMeeting('m-9', 'From the computer', 9),
    );
    await createSyncEngine({
      transport: memory,
      vault: { id: vaultIdOf(key), key, deviceId: 'computer' },
      store: {
        ids: () => ['m-9'],
        document: () => fromComputer,
        merge: () => nothing,
      },
      onRemote: () => {},
      now: () => 1,
    }).sync();
    let attempts = 0;
    const refusing: Transport = {
      ...memory,
      write: async () => {
        attempts += 1;
        throw new WritesRefused('The relay answered 429');
      },
    };
    const received: string[] = [];
    const local = [
      createDocument(startMeeting('m-1', 'Planning', 1_000)),
      createDocument(startMeeting('m-2', 'Retro', 2_000)),
      createDocument(startMeeting('m-3', 'Review', 3_000)),
    ];
    const byId = new Map(local.map((document) => [document.id, document]));
    const engine = createSyncEngine({
      transport: refusing,
      vault: { id: vaultIdOf(key), key, deviceId: 'phone' },
      store: {
        ids: () => [...byId.keys()],
        document: (id) => byId.get(id),
        merge: (id) => {
          received.push(id);
          return nothing;
        },
      },
      onRemote: () => {},
      now: () => 1,
    });

    await engine.sync();

    assert.equal(attempts, 1);
    assert.deepEqual(received, ['m-9']);
    assert.equal(engine.status().error, 'The relay answered 429');

    await engine.sync();
    assert.equal(attempts, 2);
  });
});

describe('copies held by other devices', () => {
  it('writes nothing back for what it only received, and its own copy once the other one is gone', async () => {
    const memory = createMemoryTransport();
    const fromComputer = createDocument(
      startMeeting('m-9', 'From the computer', 9),
    );
    await createSyncEngine({
      transport: memory,
      vault: { id: vaultIdOf(key), key, deviceId: 'computer' },
      store: {
        ids: () => ['m-9'],
        document: () => fromComputer,
        merge: () => nothing,
      },
      onRemote: () => {},
      now: () => 1,
    }).sync();
    const relay = countingTransport(memory);
    const local = new Map<string, MeetingDocument>();
    const phone = createSyncEngine({
      transport: relay.transport,
      vault: { id: vaultIdOf(key), key, deviceId: 'phone' },
      store: {
        ids: () => [...local.keys()],
        document: (id) => local.get(id),
        merge: (id, remote) => {
          local.set(id, remote);
          return { ...nothing, kept: true };
        },
      },
      onRemote: () => {},
      now: () => 1,
    });

    await phone.sync();
    assert.equal(relay.writes(), 0);

    await memory.remove(meetingPath('computer', 'm-9'));
    await phone.sync();

    assert.equal(relay.writes(), 1);
    assert.ok(await memory.read(meetingPath('phone', 'm-9'), 1_000_000));
  });
});

describe('what counts as merged', () => {
  it('only a file whose changes the store really kept', async () => {
    const memory = createMemoryTransport();
    const fromComputer = [
      createDocument(startMeeting('m-1', 'Kept', 1)),
      createDocument(startMeeting('m-2', 'Refused by the store', 2)),
    ];
    const byId = new Map(
      fromComputer.map((document) => [document.id, document]),
    );
    await createSyncEngine({
      transport: memory,
      vault: { id: vaultIdOf(key), key, deviceId: 'computer' },
      store: {
        ids: () => [...byId.keys()],
        document: (id) => byId.get(id),
        merge: () => nothing,
      },
      onRemote: () => {},
      now: () => 1,
    }).sync();
    const local = new Map<string, MeetingDocument>();
    const phone = createSyncEngine({
      transport: memory,
      vault: { id: vaultIdOf(key), key, deviceId: 'phone' },
      store: {
        ids: () => [...local.keys()],
        document: (id) => local.get(id),
        merge: (id, remote) => {
          if (id !== 'm-1') {
            return nothing;
          }
          local.set(id, remote);
          return { ...nothing, kept: true };
        },
      },
      onRemote: () => {},
      now: () => 1,
    });

    await phone.sync();

    const versions = new Map(
      (await memory.list('devices/')).map((file) => [file.path, file.version]),
    );
    assert.equal(
      phone.merged(meetingPath('computer', 'm-1')),
      versions.get(meetingPath('computer', 'm-1')),
    );
    assert.equal(phone.merged(meetingPath('computer', 'm-2')), undefined);
  });
});
