import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  createDocument,
  setSummary,
  startMeeting,
  type MeetingDocument,
} from '@nod/core/meetings';
import { fileKeyOf, open, randomKey, seal, vaultIdOf } from '@nod/core/crypto';
import {
  createSyncEngine,
  meetingPath,
  sealClosedNotice,
  closedPath,
  type Merged,
} from '@nod/core/sync';
import {
  createMeetingStore,
  KeyLostError,
  type Cipher,
  type MeetingFiles,
} from '@nod/core/meetings';
import type { RelayTransport } from '@nod/core/sync';
import { createMemoryTransport } from '@nod/core/sync/testing';
import { createSyncSession, type StoredVault } from './session.ts';

const relay = 'https://relay.example.com/';

function memoryRelay() {
  const memory = createMemoryTransport();
  const transport: RelayTransport = { ...memory, register: async () => {} };
  return { published: memory.paths, transport };
}

function memoryFiles() {
  const stored = new Map<string, Uint8Array>();
  const files: MeetingFiles = {
    ids: async () => [...stored.keys()],
    read: async (id) => {
      const data = stored.get(id);
      if (!data) {
        throw new Error('missing');
      }
      return data;
    },
    write: async (id, data) => {
      stored.set(id, data.slice());
    },
    setAside: async (id) => {
      stored.delete(id);
    },
  };
  return { stored, files };
}

const dataKey = randomKey();
const cipher: Cipher = {
  encrypt: (plain, context) => seal(dataKey, plain, context),
  decrypt: (data, context) => open(dataKey, data, context),
};

// The computer's side: publishes its meetings the way the desktop app does.
async function publishFromComputer(
  key: Uint8Array,
  transport: RelayTransport,
  documents: MeetingDocument[],
) {
  const byId = new Map(documents.map((document) => [document.id, document]));
  const nothing: Merged = {
    state: null,
    written: Promise.resolve(null),
    kept: false,
  };
  await createSyncEngine({
    transport,
    vault: { id: vaultIdOf(key), key, deviceId: 'computer' },
    store: {
      ids: () => [...byId.keys()],
      document: (id) => byId.get(id),
      merge: () => nothing,
    },
    onRemote: () => {},
    now: () => 1,
  }).sync();
}

async function phone(transport: RelayTransport) {
  const { stored, files } = memoryFiles();
  const store = createMeetingStore({ files, cipher: async () => cipher });
  await store.load();
  let saved: StoredVault | null = null;
  let ids = 0;
  const session = createSyncSession({
    vaults: {
      load: async () => saved,
      save: async (vault) => {
        saved = vault;
      },
      clear: async () => {
        saved = null;
      },
    },
    store,
    transportFor: () => transport,
    onRemote: () => {},
    onChange: () => {},
    newId: () => `phone-${(ids += 1)}`,
    now: () => 5,
  });
  await session.load();
  return { session, store, stored, saved: () => saved };
}

describe('pairing a phone', () => {
  it('brings every meeting over as soon as the code is scanned, and keeps them encrypted', async () => {
    const key = randomKey();
    const { published, transport } = memoryRelay();
    await publishFromComputer(key, transport, [
      createDocument(
        setSummary(startMeeting('m-1', 'Planning', 1_000), 'Ship on Friday'),
      ),
      createDocument(startMeeting('m-2', 'Retro', 2_000)),
    ]);
    const { session, store, stored, saved } = await phone(transport);
    assert.equal(session.state().status, 'unpaired');

    await session.pair({ key: key, relayUrl: relay });

    await session.refresh();

    assert.deepEqual(
      store
        .meetings()
        .map((meeting) => [meeting.id, meeting.title, meeting.summary])
        .sort(),
      [
        ['m-1', 'Planning', 'Ship on Friday'],
        ['m-2', 'Retro', null],
      ],
    );
    assert.deepEqual([...stored.keys()].sort(), ['m-1', 'm-2']);
    for (const data of stored.values()) {
      assert.equal(new TextDecoder().decode(data).includes('Planning'), false);
    }
    const state = session.state();
    assert.equal(state.status, 'paired');
    assert.equal(state.status === 'paired' && state.error, null);
    assert.equal(state.status === 'paired' && state.lastSyncedAt, 5);
    assert.equal(state.status === 'paired' && state.devices, 1);
    assert.equal(
      state.status === 'paired' && state.relayHost,
      'relay.example.com',
    );
    assert.equal(saved()?.deviceId, 'phone-1');
    assert.equal(saved()?.relayUrl, relay);
    // Every meeting came from the computer, so the vault already holds it:
    // pairing writes nothing back.
    assert.equal(
      published().some((path) => path.includes('phone-1')),
      false,
    );
  });

  it('keeps the vault it has when another one is scanned, and the device id when the same one is', async () => {
    const key = randomKey();
    const { transport } = memoryRelay();
    const { session, saved } = await phone(transport);
    await session.pair({ key: key, relayUrl: relay });
    await session.refresh();

    await assert.rejects(
      session.pair({ key: randomKey(), relayUrl: relay }),
      /another recovery phrase/,
    );
    await session.pair({ key: key, relayUrl: 'https://other.example.com/' });
    await session.refresh();
    assert.equal(saved()?.deviceId, 'phone-1');
    assert.equal(saved()?.relayUrl, 'https://other.example.com/');
  });

  it('stops syncing for good when another device closed the vault, and pairs again only with a new one', async () => {
    const key = randomKey();
    const { transport } = memoryRelay();
    const { session, store, saved } = await phone(transport);
    await session.pair({ key: key, relayUrl: relay });
    await session.refresh();
    await transport.write(
      closedPath('laptop'),
      sealClosedNotice(fileKeyOf(key), vaultIdOf(key), 'laptop', 9),
    );
    await publishFromComputer(key, transport, [
      createDocument(startMeeting('m-3', 'After the change', 3_000)),
    ]);

    await session.refresh();
    await session.refresh();

    const state = session.state();
    assert.equal(state.status === 'paired' && state.closed, true);
    assert.equal(saved()?.closed, true);
    assert.equal(store.meeting('m-3'), undefined);
    await assert.rejects(
      session.pair({ key: key, relayUrl: relay }),
      /has stopped/,
    );

    const next = randomKey();
    await session.pair({ key: next, relayUrl: relay });
    await session.refresh();
    assert.equal(saved()?.closed, false);
    assert.equal(saved()?.deviceId, 'phone-2');
  });
});

describe('a closed vault', () => {
  it('stays closed after a restart even when saving that failed the first time', async () => {
    const key = randomKey();
    const { transport } = memoryRelay();
    const { files } = memoryFiles();
    let saved: StoredVault | null = null;
    let failSaves = false;
    const savedVault = (): StoredVault | null => saved;
    const launch = async () => {
      const store = createMeetingStore({ files, cipher: async () => cipher });
      await store.load();
      const session = createSyncSession({
        vaults: {
          load: async () => saved,
          save: async (vault) => {
            if (failSaves) {
              throw new Error('keychain locked');
            }
            saved = vault;
          },
          clear: async () => {
            saved = null;
          },
        },
        store,
        transportFor: () => transport,
        onRemote: () => {},
        onChange: () => {},
        newId: () => 'phone-1',
        now: () => 5,
      });
      await session.load();
      return session;
    };
    const first = await launch();
    await first.pair({ key, relayUrl: relay });
    await first.refresh();
    await transport.write(
      closedPath('laptop'),
      sealClosedNotice(fileKeyOf(key), vaultIdOf(key), 'laptop', 9),
    );
    failSaves = true;

    await first.refresh();
    const state = first.state();
    assert.equal(state.status === 'paired' && state.closed, true);
    assert.equal(savedVault()?.closed, false);

    failSaves = false;
    await first.refresh();
    assert.equal(savedVault()?.closed, true);
  });
});

describe('starting over', () => {
  it('takes back what this phone wrote when its own copy is the only one left', async () => {
    const key = randomKey();
    const { transport } = memoryRelay();
    let saved: StoredVault | null = null;
    const launch = async (files: MeetingFiles) => {
      const store = createMeetingStore({ files, cipher: async () => cipher });
      await store.load();
      const session = createSyncSession({
        vaults: {
          load: async () => saved,
          save: async (vault) => {
            saved = vault;
          },
          clear: async () => {
            saved = null;
          },
        },
        store,
        transportFor: () => transport,
        onRemote: () => {},
        onChange: () => {},
        newId: () => 'phone-1',
        now: () => 5,
      });
      await session.load();
      return { session, store };
    };
    const before = memoryFiles();
    const first = await launch(before.files);
    await first.store.merge(
      'm-phone',
      createDocument(startMeeting('m-phone', 'Recorded on the phone', 3_000)),
    ).written;
    await first.session.pair({ key, relayUrl: relay });
    await first.session.refresh();

    const fresh = await launch(memoryFiles().files);
    await fresh.session.refresh();

    assert.equal(
      fresh.store.meeting('m-phone')?.title,
      'Recorded on the phone',
    );
  });
});

describe('leaving a vault', () => {
  it('removes what the phone published, keeps its meetings, and lets it pair with another code', async () => {
    const key = randomKey();
    const { published, transport } = memoryRelay();
    await publishFromComputer(key, transport, [
      createDocument(startMeeting('m-1', 'Planning', 1_000)),
    ]);
    const { session, store, saved } = await phone(transport);
    await store.merge(
      'm-local',
      createDocument(startMeeting('m-local', 'Only on the phone', 3_000)),
    ).written;
    await session.pair({ key: key, relayUrl: relay });
    await session.refresh();
    assert.equal(published().includes(meetingPath('phone-1', 'm-local')), true);
    assert.equal(published().includes(meetingPath('phone-1', 'm-1')), false);

    await session.unpair();

    assert.equal(session.state().status, 'unpaired');
    assert.equal(saved(), null);
    assert.equal(
      published().includes(meetingPath('phone-1', 'm-local')),
      false,
    );
    assert.equal(published().includes(meetingPath('computer', 'm-1')), true);
    assert.equal(store.meeting('m-1')?.title, 'Planning');
    await session.pair({ key: randomKey(), relayUrl: relay });
    await session.refresh();
    assert.equal(saved()?.deviceId, 'phone-2');
  });
});

describe('stopping while a round runs', () => {
  it('unpairs at once, and the stopped round writes nothing back', async () => {
    const key = randomKey();
    const { published, transport } = memoryRelay();
    await publishFromComputer(key, transport, [
      createDocument(startMeeting('m-1', 'Planning', 1_000)),
      createDocument(startMeeting('m-2', 'Retro', 2_000)),
    ]);
    let release = () => {};
    let held = false;
    let phoneWrites = 0;
    const slow: RelayTransport = {
      ...transport,
      write: async (path, data) => {
        if (path.includes('phone-1')) {
          phoneWrites += 1;
        }
        await transport.write(path, data);
      },
      read: async (path, maxBytes) => {
        if (!held) {
          held = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return transport.read(path, maxBytes);
      },
    };
    const { session, store, saved } = await phone(slow);
    await store.merge(
      'm-local',
      createDocument(startMeeting('m-local', 'Only on the phone', 3_000)),
    ).written;
    await session.pair({ key, relayUrl: relay });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const stopping = session.unpair();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(session.state().status, 'unpaired');
    assert.equal(saved(), null);

    release();
    await stopping;
    assert.equal(phoneWrites, 0);
    assert.equal(
      published().some((path) => path.includes('phone-1')),
      false,
    );
  });
});

describe('sync rounds', () => {
  it('doesn’t write every meeting again when the app starts again', async () => {
    const key = randomKey();
    const { transport } = memoryRelay();
    await publishFromComputer(key, transport, [
      createDocument(startMeeting('m-1', 'Planning', 1_000)),
      createDocument(startMeeting('m-2', 'Retro', 2_000)),
    ]);
    let writes = 0;
    const counted: RelayTransport = {
      ...transport,
      write: async (path, data) => {
        writes += 1;
        await transport.write(path, data);
      },
    };
    const { stored, files } = memoryFiles();
    const log = new Map<string, string>();
    let saved: StoredVault | null = null;
    const launch = async () => {
      const store = createMeetingStore({ files, cipher: async () => cipher });
      await store.load();
      const session = createSyncSession({
        vaults: {
          load: async () => saved,
          save: async (vault) => {
            saved = vault;
          },
          clear: async () => {
            saved = null;
          },
        },
        store,
        transportFor: () => counted,
        publishedLogFor: async () => ({
          get: (id) => log.get(id),
          set: (id, heads) => {
            log.set(id, heads);
          },
        }),
        onRemote: () => {},
        onChange: () => {},
        newId: () => 'phone-1',
        now: () => 5,
      });
      await session.load();
      return session;
    };
    const seed = createMeetingStore({ files, cipher: async () => cipher });
    await seed.load();
    await seed.merge(
      'm-local',
      createDocument(startMeeting('m-local', 'Only on the phone', 3_000)),
    ).written;
    const first = await launch();
    await first.pair({ key: key, relayUrl: relay });
    await first.refresh();
    // Only the meeting the vault lacked; the two from the computer are held.
    assert.equal(writes, 1);
    assert.equal(stored.size, 3);

    const second = await launch();
    await second.refresh();

    assert.equal(writes, 1);
  });

  it('lets rounds asked for while one waits join it instead of piling up', async () => {
    const key = randomKey();
    const { transport } = memoryRelay();
    let lists = 0;
    const counting: RelayTransport = {
      ...transport,
      list: async (prefix) => {
        lists += 1;
        return transport.list(prefix);
      },
    };
    const { session } = await phone(counting);
    await session.pair({ key: key, relayUrl: relay });
    await session.refresh();
    lists = 0;

    const first = session.refresh();
    const second = session.refresh();
    const third = session.refresh();
    await Promise.all([first, second, third]);

    assert.equal(first, second);
    assert.equal(second, third);
    // One round lists the vault once, for closed notices and to sync.
    assert.equal(lists, 1);
  });

  it('offers a way out of saved sync settings it can’t read', async () => {
    const { transport } = memoryRelay();
    const { stored, files } = memoryFiles();
    const store = createMeetingStore({ files, cipher: async () => cipher });
    await store.load();
    let cleared = false;
    const session = createSyncSession({
      vaults: {
        load: async () => {
          throw new Error('Sync settings on this phone are damaged');
        },
        save: async () => {},
        clear: async () => {
          cleared = true;
        },
      },
      store,
      transportFor: () => transport,
      onRemote: () => {},
      onChange: () => {},
      newId: () => 'phone-1',
      now: () => 5,
    });
    await session.load();
    const state = session.state();
    assert.equal(state.status === 'unavailable' && state.reset, 'pair-again');
    await assert.rejects(
      session.pair({ key: randomKey(), relayUrl: relay }),
      /Stop syncing/,
    );

    await session.unpair();

    assert.equal(cleared, true);
    assert.equal(stored.size, 0);
    await session.pair({ key: randomKey(), relayUrl: relay });
    await session.refresh();
    assert.equal(session.state().status, 'paired');
  });
});

describe('meetings on the phone', () => {
  it('keeps meetings whose key is missing until the user starts over, then uses a new key', async () => {
    const { stored, files } = memoryFiles();
    stored.set('m-1', new Uint8Array([1, 2, 3]));
    const asked: string[] = [];
    const store = createMeetingStore({
      files,
      cipher: async (mode) => {
        asked.push(mode);
        if (mode === 'open') {
          throw new KeyLostError('missing');
        }
        return cipher;
      },
    });

    await assert.rejects(store.load(), KeyLostError);
    assert.deepEqual([...stored.keys()], ['m-1']);

    await store.startOver();

    assert.deepEqual(asked, ['open', 'replace']);
    assert.deepEqual([...stored.keys()], []);
    const merged = store.merge(
      'm-1',
      createDocument(startMeeting('m-1', 'Back from the computer', 1_000)),
    );
    await merged.written;
    assert.equal(store.meeting('m-1')?.title, 'Back from the computer');
  });

  it('doesn’t start on other failures to get the key', async () => {
    const { stored, files } = memoryFiles();
    stored.set('m-1', new Uint8Array([1, 2, 3]));
    const store = createMeetingStore({
      files,
      cipher: async () => {
        throw new Error('keychain locked');
      },
    });

    await assert.rejects(store.load(), /keychain locked/);
    assert.equal(stored.has('m-1'), true);
  });

  it('keeps a file it can’t read until a healthy copy from another device replaces it', async () => {
    const { stored, files } = memoryFiles();
    stored.set('m-1', new Uint8Array([1, 2, 3]));
    const store = createMeetingStore({ files, cipher: async () => cipher });
    await store.load();
    assert.equal(store.meeting('m-1'), undefined);
    assert.deepEqual([...(stored.get('m-1') ?? [])], [1, 2, 3]);

    const merged = store.merge(
      'm-1',
      createDocument(startMeeting('m-1', 'Restored', 1_000)),
    );
    assert.equal(merged.state, null);
    assert.equal((await merged.written)?.kind, 'meeting');
    assert.equal(store.meeting('m-1')?.title, 'Restored');
    assert.notDeepEqual([...(stored.get('m-1') ?? [])], [1, 2, 3]);
  });

  it('ignores a copy filed under another meeting’s id', async () => {
    const { files } = memoryFiles();
    const store = createMeetingStore({ files, cipher: async () => cipher });
    await store.load();

    const merged = store.merge(
      'm-1',
      createDocument(startMeeting('m-2', 'Elsewhere', 1_000)),
    );
    assert.equal(merged.state, null);
    assert.deepEqual(store.meetings(), []);
  });
});
