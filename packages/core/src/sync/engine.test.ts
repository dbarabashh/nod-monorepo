import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  bytesOf,
  fileKeyOf,
  open,
  randomKey,
  seal,
  vaultIdOf,
} from '../crypto/index.ts';
import {
  createDocument,
  createMeetingStore,
  loadDocument,
  readDocument,
  saveDocument,
  startMeeting,
  type MeetingDocument,
  type MeetingFiles,
  type Merged,
} from '../meetings/index.ts';
import {
  createSyncEngine,
  memoryReceivedLog,
  type PublishedEntry,
  type PublishedLog,
} from './engine.ts';
import { closedPath, meetingContext, meetingPath } from './layout.ts';
import { countingTransport, createMemoryTransport } from './testing/index.ts';
import { Throttled, WritesRefused, type Transport } from './transport.ts';

function memoryLog(): PublishedLog & { entries: Map<string, PublishedEntry> } {
  const entries = new Map<string, PublishedEntry>();
  return {
    entries,
    get: (id) => entries.get(id),
    set: (id, entry) => {
      entries.set(id, entry);
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

describe('a copy the place changed', () => {
  const vaultId = vaultIdOf(key);
  const titleOf = (sealed: Uint8Array | null) => {
    const document = loadDocument(
      open(
        fileKeyOf(key),
        sealed ?? new Uint8Array(),
        meetingContext(vaultId, 'phone', 'm-1'),
      ),
    );
    const state = document ? readDocument(document) : null;
    return state?.kind === 'meeting' ? state.meeting.title : null;
  };

  it('writes its copy again once the place lists it under another version', async () => {
    const memory = createMemoryTransport();
    const relay = countingTransport(memory);
    const log = memoryLog();
    const path = meetingPath('phone', 'm-1');
    await engineFor(
      relay.transport,
      [createDocument(startMeeting('m-1', 'Planning', 1_000))],
      log,
    ).sync();
    const stale = await memory.read(path, 1_000_000);
    const engine = engineFor(
      relay.transport,
      [createDocument(startMeeting('m-1', 'Planning, renamed', 1_000))],
      log,
    );
    await engine.sync();
    await engine.sync();
    assert.equal(relay.writes(), 2);
    assert.equal(
      titleOf(await memory.read(path, 1_000_000)),
      'Planning, renamed',
    );

    await memory.write(path, stale ?? new Uint8Array());
    assert.equal(titleOf(await memory.read(path, 1_000_000)), 'Planning');
    await engine.sync();

    assert.equal(relay.writes(), 3);
    assert.equal(
      titleOf(await memory.read(path, 1_000_000)),
      'Planning, renamed',
    );
    await engine.sync();
    assert.equal(relay.writes(), 3);
  });

  it('reads, and doesn’t write, a copy a lagging or re-stamping listing shows under another version', async () => {
    const documents = [createDocument(startMeeting('m-1', 'Planning', 1_000))];
    for (const shape of ['lagging', 'restamping']) {
      const memory = createMemoryTransport();
      let previous: Awaited<ReturnType<typeof memory.list>> = [];
      let rounds = 0;
      let reads = 0;
      const odd: Transport = {
        ...memory,
        list: async (prefix) => {
          rounds += 1;
          const fresh = await memory.list(prefix);
          if (shape === 'lagging') {
            const shown = previous;
            previous = fresh;
            return shown;
          }
          return fresh.map((file) => ({
            ...file,
            version: rounds > 1 ? `${file.version}-stamped` : file.version,
          }));
        },
        read: (path, maxBytes) => {
          reads += 1;
          return memory.read(path, maxBytes);
        },
      };
      const relay = countingTransport(odd);
      const log = memoryLog();
      const engine = engineFor(relay.transport, documents, log);
      for (let round = 0; round < 6; round += 1) {
        await engine.sync();
      }
      assert.equal(relay.writes(), 1, shape);
      assert.equal(reads, shape === 'lagging' ? 1 : 2, shape);
      const [listed] = await odd.list('devices/');
      assert.equal(log.entries.get('m-1')?.version, listed?.version, shape);
    }
  });

  it('doesn’t take a lagging listing’s version, so a copy restored under it is still noticed', async () => {
    const memory = createMemoryTransport();
    const path = meetingPath('phone', 'm-1');
    const shown = new Map<string, string>();
    let lag = false;
    let previous: Awaited<ReturnType<typeof memory.list>> = [];
    const place: Transport = {
      ...memory,
      list: async (prefix) => {
        const fresh = (await memory.list(prefix)).map((file) => ({
          ...file,
          version: shown.get(file.path) ?? file.version,
        }));
        const listing = lag ? previous : fresh;
        previous = fresh;
        return listing;
      },
    };
    const relay = countingTransport(place);
    const log = memoryLog();
    await engineFor(
      relay.transport,
      [createDocument(startMeeting('m-1', 'Planning', 1_000))],
      log,
    ).sync();
    const stale = await memory.read(path, 1_000_000);
    const [first] = await memory.list('devices/');
    const engine = engineFor(
      relay.transport,
      [createDocument(startMeeting('m-1', 'Planning, renamed', 1_000))],
      log,
    );
    await engine.sync();
    assert.equal(relay.writes(), 2);
    lag = true;
    await engine.sync();
    assert.equal(relay.writes(), 2);
    assert.notEqual(log.entries.get('m-1')?.version, first?.version);

    lag = false;
    await memory.write(path, stale ?? new Uint8Array());
    shown.set(path, first?.version ?? '');
    await engine.sync();

    assert.equal(relay.writes(), 3);
    assert.equal(
      titleOf(await memory.read(path, 1_000_000)),
      'Planning, renamed',
    );
  });

  it('takes the listed version as its copy’s only when the place named none at the write', async () => {
    const memory = createMemoryTransport();
    const silent: Transport = {
      ...memory,
      write: async (path, data) => {
        await memory.write(path, data);
        return null;
      },
    };
    const counted = countingTransport(silent);
    const log = memoryLog();
    const engine = engineFor(
      counted.transport,
      [createDocument(startMeeting('m-1', 'Planning', 1_000))],
      log,
    );
    await engine.sync();
    assert.equal(log.entries.get('m-1')?.version, null);
    await engine.sync();
    const [listed] = await memory.list('devices/');
    assert.equal(log.entries.get('m-1')?.version, listed?.version);
    await engine.sync();
    assert.equal(counted.writes(), 1);
  });
});

describe('a file that can’t be read', () => {
  const path = meetingPath('computer', 'm-1');
  const unreadable = 'A meeting from another device could not be read';

  function reading(memory: Transport) {
    let reads = 0;
    const transport: Transport = {
      ...memory,
      read: (target, maxBytes) => {
        reads += 1;
        return memory.read(target, maxBytes);
      },
    };
    return { transport, reads: () => reads };
  }

  it('is fetched once per version, and reported until the place changes it', async () => {
    const memory = createMemoryTransport();
    await memory.write(
      path,
      bytesOf('not sealed for this vault, and long enough'),
    );
    const counted = reading(memory);
    const engine = engineFor(counted.transport, [], memoryLog());

    await engine.sync();
    await engine.sync();

    assert.equal(counted.reads(), 1);
    assert.equal(engine.status().error, unreadable);
    assert.equal(engine.status().lastSyncedAt, null);

    await memory.write(
      path,
      seal(
        fileKeyOf(key),
        saveDocument(createDocument(startMeeting('m-1', 'Fixed', 1))),
        meetingContext(vaultIdOf(key), 'computer', 'm-1'),
      ),
    );
    await engine.sync();

    assert.equal(counted.reads(), 2);
    assert.equal(engine.status().error, null);
  });

  it('is fetched once per version when it holds another meeting than its name says', async () => {
    const memory = createMemoryTransport();
    await memory.write(
      path,
      seal(
        fileKeyOf(key),
        saveDocument(createDocument(startMeeting('m-2', 'Misfiled', 1))),
        meetingContext(vaultIdOf(key), 'computer', 'm-1'),
      ),
    );
    const counted = reading(memory);
    const merged: string[] = [];
    const engine = createSyncEngine({
      transport: counted.transport,
      vault: { id: vaultIdOf(key), key, deviceId: 'phone' },
      store: {
        ids: () => [],
        document: () => undefined,
        merge: (id) => {
          merged.push(id);
          return nothing;
        },
      },
      onRemote: () => {},
      now: () => 1,
    });

    await engine.sync();
    await engine.sync();

    assert.equal(counted.reads(), 1);
    assert.deepEqual(merged, []);
    assert.equal(engine.status().error, unreadable);
  });

  it('gives up on a file larger than any meeting, until the place changes it', async () => {
    const memory = createMemoryTransport();
    await memory.write(path, new Uint8Array(16 * 1024 * 1024 + 1));
    const counted = reading(memory);
    const engine = engineFor(counted.transport, [], memoryLog());

    await engine.sync();
    await engine.sync();

    assert.equal(counted.reads(), 1);
    assert.match(engine.status().error ?? '', /larger than expected/);
  });

  it('tries again a file the place just failed to send', async () => {
    const memory = createMemoryTransport();
    await memory.write(path, bytesOf('whatever'));
    let reads = 0;
    const flaky: Transport = {
      ...memory,
      read: async () => {
        reads += 1;
        throw new Error('The relay answered 503');
      },
    };
    const engine = engineFor(flaky, [], memoryLog());

    await engine.sync();
    await engine.sync();

    assert.equal(reads, 2);
    assert.equal(engine.status().error, 'The relay answered 503');
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
        throw new WritesRefused('The relay answered 507');
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
    assert.equal(engine.status().error, 'The relay answered 507');

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

describe('a place that asks to wait', () => {
  const waiting =
    'The relay answered 429: it asked this device to wait, sync will try again later';

  function laptopFile(id: string, title: string) {
    return seal(
      fileKeyOf(key),
      saveDocument(createDocument(startMeeting(id, title, 1))),
      meetingContext(vaultIdOf(key), 'laptop', id),
    );
  }

  function counting(memory: Transport, failing: () => Error | null) {
    const counts = { lists: 0, reads: 0, writes: 0 };
    const transport: Transport = {
      ...memory,
      list: (prefix) => {
        counts.lists += 1;
        return memory.list(prefix);
      },
      read: async (path, maxBytes) => {
        counts.reads += 1;
        const failure = failing();
        if (failure) {
          throw failure;
        }
        return memory.read(path, maxBytes);
      },
      write: async (path, data) => {
        counts.writes += 1;
        const failure = failing();
        if (failure) {
          throw failure;
        }
        return memory.write(path, data);
      },
    };
    return { transport, counts };
  }

  function phone(
    transport: Transport,
    own: MeetingDocument[],
    clock: { at: number },
  ) {
    const received: string[] = [];
    const byId = new Map(own.map((document) => [document.id, document]));
    const engine = createSyncEngine({
      transport,
      vault: { id: vaultIdOf(key), key, deviceId: 'phone' },
      store: {
        ids: () => [...byId.keys()],
        document: (id) => byId.get(id),
        merge: (id, remote) => {
          received.push(id);
          byId.set(id, remote);
          return { ...nothing, kept: true };
        },
      },
      onRemote: () => {},
      now: () => clock.at,
    });
    return { engine, received };
  }

  it('ends the round at the first refused read and makes no request until the wait is over', async () => {
    const memory = createMemoryTransport();
    for (const [id, title] of [
      ['m-1', 'Planning'],
      ['m-2', 'Retro'],
      ['m-3', 'Review'],
    ]) {
      await memory.write(meetingPath('laptop', id), laptopFile(id, title));
    }
    let requests = 0;
    const counted = counting(memory, () => {
      requests += 1;
      return requests === 2 ? new Throttled(waiting, 60_000) : null;
    });
    const clock = { at: 1_000 };
    const { engine, received } = phone(
      counted.transport,
      [createDocument(startMeeting('m-9', 'Own', 9_000))],
      clock,
    );

    await engine.sync();
    assert.deepEqual(received, ['m-1']);
    assert.deepEqual(counted.counts, { lists: 1, reads: 2, writes: 0 });
    assert.equal(engine.status().error, waiting);
    assert.equal(engine.status().lastSyncedAt, null);

    clock.at = 1_000 + 59_999;
    await engine.sync();
    assert.deepEqual(counted.counts, { lists: 1, reads: 2, writes: 0 });
    assert.equal(engine.status().error, waiting);

    clock.at = 1_000 + 60_000;
    await engine.sync();
    assert.deepEqual(received, ['m-1', 'm-2', 'm-3']);
    assert.deepEqual(counted.counts, { lists: 2, reads: 4, writes: 1 });
    assert.equal(engine.status().error, null);
    assert.equal(engine.status().lastSyncedAt, 61_000);
  });

  it('ends the round at the first refused write the same way', async () => {
    let requests = 0;
    const counted = counting(createMemoryTransport(), () => {
      requests += 1;
      return requests === 1 ? new Throttled(waiting, 5_000) : null;
    });
    const clock = { at: 1_000 };
    const { engine } = phone(
      counted.transport,
      [
        createDocument(startMeeting('m-1', 'Planning', 1_000)),
        createDocument(startMeeting('m-2', 'Retro', 2_000)),
        createDocument(startMeeting('m-3', 'Review', 3_000)),
      ],
      clock,
    );

    await engine.sync();
    assert.deepEqual(counted.counts, { lists: 1, reads: 0, writes: 1 });
    assert.equal(engine.status().error, waiting);

    clock.at = 1_000 + 4_999;
    await engine.sync();
    assert.deepEqual(counted.counts, { lists: 1, reads: 0, writes: 1 });

    clock.at = 1_000 + 5_000;
    await engine.sync();
    assert.deepEqual(counted.counts, { lists: 2, reads: 0, writes: 4 });
    assert.equal(engine.status().error, null);
  });

  it('drops a wait that reaches further than any the place could ask for, as a clock that jumped back leaves', async () => {
    let requests = 0;
    const counted = counting(createMemoryTransport(), () => {
      requests += 1;
      return requests === 1 ? new Throttled(waiting, 60_000) : null;
    });
    const clock = { at: 100 * 60_000 };
    const { engine } = phone(
      counted.transport,
      [createDocument(startMeeting('m-1', 'Planning', 1_000))],
      clock,
    );

    await engine.sync();
    clock.at = 100 * 60_000 - 9 * 60_000;
    await engine.sync();
    assert.deepEqual(counted.counts, { lists: 1, reads: 0, writes: 1 });

    clock.at = 100 * 60_000 - 9 * 60_000 - 1;
    await engine.sync();
    assert.deepEqual(counted.counts, { lists: 2, reads: 0, writes: 2 });
    assert.equal(engine.status().error, null);
  });

  it('waits when the listing itself is refused', async () => {
    const memory = createMemoryTransport();
    let lists = 0;
    const refusing: Transport = {
      ...memory,
      list: async () => {
        lists += 1;
        throw new Throttled(waiting, 60_000);
      },
    };
    const clock = { at: 1_000 };
    const { engine } = phone(refusing, [], clock);

    await engine.sync();
    await engine.sync();
    assert.equal(lists, 1);
    assert.equal(engine.status().error, waiting);

    clock.at = 1_000 + 60_000;
    await engine.sync();
    assert.equal(lists, 2);
  });
});

describe('receiving across launches', () => {
  const vaultId = vaultIdOf(key);
  const laptopFile = (document: MeetingDocument) =>
    seal(
      fileKeyOf(key),
      saveDocument(document),
      meetingContext(vaultId, 'laptop', document.id),
    );
  const logWithReceived = () => ({
    ...memoryLog(),
    received: memoryReceivedLog(),
  });

  // What the phone keeps on disk across launches, by meeting id.
  function phone(
    transport: Transport,
    log: PublishedLog,
    disk: Map<string, MeetingDocument>,
  ) {
    const merged: string[] = [];
    const engine = createSyncEngine({
      transport,
      vault: { id: vaultId, key, deviceId: 'phone' },
      store: {
        ids: () => [...disk.keys()],
        document: (id) => disk.get(id),
        merge: (id, remote) => {
          merged.push(id);
          disk.set(id, remote);
          return { ...nothing, kept: true };
        },
      },
      onRemote: () => {},
      now: () => 1,
      publishedLog: log,
    });
    return { engine, merged };
  }

  function reading(memory: Transport) {
    let reads = 0;
    const transport: Transport = {
      ...memory,
      read: (path, maxBytes) => {
        reads += 1;
        return memory.read(path, maxBytes);
      },
    };
    return { transport, reads: () => reads };
  }

  it('reads each file of another device once, until the place lists it under another version or stops listing it', async () => {
    const memory = createMemoryTransport();
    const planning = createDocument(startMeeting('m-1', 'Planning', 1_000));
    const retro = createDocument(startMeeting('m-2', 'Retro', 2_000));
    await memory.write(meetingPath('laptop', 'm-1'), laptopFile(planning));
    await memory.write(meetingPath('laptop', 'm-2'), laptopFile(retro));
    const counted = reading(memory);
    const log = logWithReceived();
    const disk = new Map<string, MeetingDocument>();

    const first = phone(counted.transport, log, disk);
    await first.engine.sync();
    assert.deepEqual(first.merged, ['m-1', 'm-2']);
    assert.equal(counted.reads(), 2);

    const second = phone(counted.transport, log, disk);
    await second.engine.sync();
    assert.deepEqual(second.merged, []);
    assert.equal(counted.reads(), 2);
    assert.equal(second.engine.status().error, null);

    await memory.write(
      meetingPath('laptop', 'm-2'),
      laptopFile(createDocument(startMeeting('m-2', 'Retro, renamed', 2_000))),
    );
    await second.engine.sync();
    assert.deepEqual(second.merged, ['m-2']);
    assert.equal(counted.reads(), 3);

    await memory.remove(meetingPath('laptop', 'm-1'));
    await second.engine.sync();
    assert.equal(log.received.get(meetingPath('laptop', 'm-1')), undefined);
    assert.notEqual(log.received.get(meetingPath('laptop', 'm-2')), undefined);
  });

  it('keeps what it read of a device a listing leaves out, as a narrowed one or an unmounted folder does', async () => {
    const memory = createMemoryTransport();
    await memory.write(
      meetingPath('laptop', 'm-1'),
      laptopFile(createDocument(startMeeting('m-1', 'Planning', 1_000))),
    );
    const log = logWithReceived();
    const disk = new Map<string, MeetingDocument>();
    const { engine } = phone(memory, log, disk);
    await engine.sync();
    assert.notEqual(log.received.get(meetingPath('laptop', 'm-1')), undefined);

    await engine.sync([]);
    await engine.sync([
      { path: meetingPath('tablet', 'm-9'), version: 'v9', changedAt: 1 },
    ]);
    assert.notEqual(log.received.get(meetingPath('laptop', 'm-1')), undefined);

    await engine.sync([
      { path: meetingPath('laptop', 'm-2'), version: 'v2', changedAt: 1 },
    ]);
    assert.equal(log.received.get(meetingPath('laptop', 'm-1')), undefined);
  });

  it('drops what it read of a device that left a closing notice, or that was forgotten', async () => {
    const memory = createMemoryTransport();
    for (const device of ['laptop', 'tablet']) {
      await memory.write(
        meetingPath(device, 'm-1'),
        seal(
          fileKeyOf(key),
          saveDocument(createDocument(startMeeting('m-1', 'Planning', 1_000))),
          meetingContext(vaultId, device, 'm-1'),
        ),
      );
    }
    const log = logWithReceived();
    const { engine } = phone(memory, log, new Map());
    await engine.sync();
    assert.notEqual(log.received.get(meetingPath('laptop', 'm-1')), undefined);
    assert.notEqual(log.received.get(meetingPath('tablet', 'm-1')), undefined);

    await engine.sync([
      { path: closedPath('laptop'), version: 'c1', changedAt: 2 },
      { path: meetingPath('tablet', 'm-1'), version: 'v1', changedAt: 1 },
    ]);
    assert.equal(log.received.get(meetingPath('laptop', 'm-1')), undefined);
    assert.notEqual(log.received.get(meetingPath('tablet', 'm-1')), undefined);

    engine.forget('tablet');
    assert.equal(log.received.get(meetingPath('tablet', 'm-1')), undefined);
  });

  it('still writes no copy of its own of a meeting it only received', async () => {
    const memory = createMemoryTransport();
    const relay = countingTransport(memory);
    const planning = createDocument(startMeeting('m-1', 'Planning', 1_000));
    await memory.write(meetingPath('laptop', 'm-1'), laptopFile(planning));
    const log = logWithReceived();
    const disk = new Map([[planning.id, planning]]);

    await phone(relay.transport, log, disk).engine.sync();
    assert.equal(relay.writes(), 0);

    const restarted = phone(relay.transport, log, disk);
    await restarted.engine.sync();
    assert.equal(relay.writes(), 0);
    const listedUnder = (await memory.list('devices/'))[0]?.version;
    assert.ok(listedUnder);
    assert.equal(
      restarted.engine.merged(meetingPath('laptop', 'm-1')),
      listedUnder,
    );

    await memory.remove(meetingPath('laptop', 'm-1'));
    await restarted.engine.sync();
    assert.equal(relay.writes(), 1);
  });
});

describe('what was received, against a store that lost it', () => {
  const vaultId = vaultIdOf(key);
  const plain = {
    encrypt: (data: Uint8Array) => data,
    decrypt: (data: Uint8Array) => data,
  };

  function memoryFiles() {
    const stored = new Map<string, Uint8Array>();
    const damaged = new Set<string>();
    const files: MeetingFiles = {
      ids: async () => [...stored.keys()],
      read: async (id) =>
        damaged.has(id)
          ? new Uint8Array([1, 2, 3])
          : (stored.get(id) ?? new Uint8Array()),
      write: async (id, data) => {
        stored.set(id, data.slice());
      },
      setAside: async (id) => {
        stored.delete(id);
        damaged.delete(id);
      },
    };
    return { files, damage: (id: string) => damaged.add(id) };
  }

  async function laptopWrote(memory: Transport, title: string) {
    await memory.write(
      meetingPath('laptop', 'm-1'),
      seal(
        fileKeyOf(key),
        saveDocument(createDocument(startMeeting('m-1', title, 1_000))),
        meetingContext(vaultId, 'laptop', 'm-1'),
      ),
    );
  }

  function phone(
    transport: Transport,
    store: ReturnType<typeof createMeetingStore>,
    received: ReturnType<typeof memoryReceivedLog>,
  ) {
    return createSyncEngine({
      transport,
      vault: { id: vaultId, key, deviceId: 'phone' },
      store,
      onRemote: () => {},
      now: () => 1,
      publishedLog: { ...memoryLog(), received },
    });
  }

  it('reads the meeting again after the store started over', async () => {
    const memory = createMemoryTransport();
    await laptopWrote(memory, 'Planning');
    const store = createMeetingStore({
      files: memoryFiles().files,
      cipher: async () => plain,
    });
    await store.load();
    const received = memoryReceivedLog();
    await phone(memory, store, received).sync();
    assert.deepEqual(store.ids(), ['m-1']);

    await store.startOver();
    assert.deepEqual(store.ids(), []);
    const after = phone(memory, store, received);
    await after.sync();
    assert.equal(after.status().error, null);
    assert.deepEqual(store.ids(), ['m-1']);
  });

  it('replaces a file damaged since, from the other device’s copy, after a relaunch', async () => {
    const memory = createMemoryTransport();
    await laptopWrote(memory, 'Planning');
    const disk = memoryFiles();
    const store = createMeetingStore({
      files: disk.files,
      cipher: async () => plain,
    });
    await store.load();
    const received = memoryReceivedLog();
    await phone(memory, store, received).sync();
    assert.equal(store.meetings().length, 1);

    disk.damage('m-1');
    const relaunched = createMeetingStore({
      files: disk.files,
      cipher: async () => plain,
    });
    await relaunched.load();
    assert.deepEqual(relaunched.meetings(), []);
    const after = phone(memory, relaunched, received);
    assert.equal(after.merged(meetingPath('laptop', 'm-1')), undefined);
    await after.sync();
    assert.equal(relaunched.meetings()[0]?.title, 'Planning');
    assert.notEqual(after.merged(meetingPath('laptop', 'm-1')), undefined);
  });

  it('doesn’t count a file as read while the store wasn’t loaded to keep it', async () => {
    const memory = createMemoryTransport();
    await laptopWrote(memory, 'Planning');
    const store = createMeetingStore({
      files: memoryFiles().files,
      cipher: async () => plain,
    });
    const received = memoryReceivedLog();
    await phone(memory, store, received).sync();
    assert.equal(received.get(meetingPath('laptop', 'm-1')), undefined);

    await store.load();
    await phone(memory, store, received).sync();
    assert.deepEqual(store.ids(), ['m-1']);
  });
});
