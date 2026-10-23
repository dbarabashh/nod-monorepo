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
import type { PublishedEntry, RelayTransport } from '@nod/core/sync';
import { memoryFiles } from '@nod/core/meetings/testing';
import { createMemoryTransport } from '@nod/core/sync/testing';
import { createSyncSession, type StoredVault } from './session.ts';
import { createPublishedLog, Throttled } from '@nod/core/sync';

const relay = 'https://relay.example.com/';

function memoryRelay() {
  const memory = createMemoryTransport();
  const transport: RelayTransport = { ...memory, register: async () => {} };
  return { published: memory.paths, transport };
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
  const files = memoryFiles();
  const { stored } = files;
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
    const files = memoryFiles();
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
    const first = await launch(before);
    await first.store.merge(
      'm-phone',
      createDocument(startMeeting('m-phone', 'Recorded on the phone', 3_000)),
    ).written;
    await first.session.pair({ key, relayUrl: relay });
    await first.session.refresh();

    const fresh = await launch(memoryFiles());
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
        return transport.write(path, data);
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
        return transport.write(path, data);
      },
    };
    const files = memoryFiles();
    const { stored } = files;
    const log = new Map<string, PublishedEntry>();
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
          set: (id, entry) => {
            log.set(id, entry);
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
    const files = memoryFiles();
    const { stored } = files;
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
    const files = memoryFiles();
    const { stored } = files;
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
    const files = memoryFiles();
    const { stored } = files;
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
    const files = memoryFiles();
    const { stored } = files;
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
    const store = createMeetingStore({
      files: memoryFiles(),
      cipher: async () => cipher,
    });
    await store.load();

    const merged = store.merge(
      'm-1',
      createDocument(startMeeting('m-2', 'Elsewhere', 1_000)),
    );
    assert.equal(merged.state, null);
    assert.deepEqual(store.meetings(), []);
  });
});

describe('a relay that asked the phone to wait', () => {
  it('is not asked to register again before the wait is over, and the wait is shown without flicker', async () => {
    const waiting =
      'The relay answered 429: it asked this device to wait, sync will try again in about 2 minutes';
    const { transport } = memoryRelay();
    let registrations = 0;
    const refusing: RelayTransport = {
      ...transport,
      register: async () => {
        registrations += 1;
        throw new Throttled(waiting, 120_000);
      },
    };
    const clock = { at: 1_000 };
    const files = memoryFiles();
    const { stored } = files;
    const store = createMeetingStore({ files, cipher: async () => cipher });
    await store.load();
    let saved: StoredVault | null = null;
    let shownSyncing = 0;
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
      transportFor: () => refusing,
      onRemote: () => {},
      onChange: () => {
        const state = session.state();
        if (state.status === 'paired' && state.syncing) {
          shownSyncing += 1;
        }
      },
      newId: () => 'phone-1',
      now: () => clock.at,
    });
    await session.load();
    const key = randomKey();
    await session.pair({ key, relayUrl: relay });
    await session.refresh();
    const shown = () => {
      const state = session.state();
      return state.status === 'paired' ? state.error : null;
    };
    assert.equal(shown(), waiting);
    assert.equal(registrations, 1);
    assert.equal(stored.size, 0);
    assert.equal(shownSyncing, 1);

    clock.at = 1_000 + 119_999;
    await session.refresh();
    assert.equal(registrations, 1);
    assert.equal(shownSyncing, 1);
    assert.equal(
      shown(),
      'The relay answered 429: it asked this device to wait, sync will try again in a moment',
    );

    clock.at = 1_000 + 120_000;
    await session.refresh();
    assert.equal(registrations, 2);
    assert.equal(shownSyncing, 2);

    clock.at = 1_000 + 130_000;
    await session.pair({ key, relayUrl: relay });
    await session.refresh();
    assert.equal(registrations, 3);

    clock.at = 1_000 + 140_000;
    await session.refresh();
    assert.equal(registrations, 3);
  });
});

describe('what the phone read of the computer', () => {
  it('is read once, across launches, until the computer changes it', async () => {
    const key = randomKey();
    const { transport } = memoryRelay();
    await publishFromComputer(key, transport, [
      createDocument(startMeeting('m-1', 'Planning', 1_000)),
      createDocument(startMeeting('m-2', 'Retro', 2_000)),
    ]);
    let reads = 0;
    const counted: RelayTransport = {
      ...transport,
      read: async (path, maxBytes) => {
        reads += 1;
        return transport.read(path, maxBytes);
      },
    };
    const files = memoryFiles();
    const log = createPublishedLog({
      scope: 'phone',
      entries: new Map(),
      received: new Map(),
      save: () => {},
      delayMs: 0,
    });
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
        publishedLogFor: async () => log,
        onRemote: () => {},
        onChange: () => {},
        newId: () => 'phone-1',
        now: () => 5,
      });
      await session.load();
      return { session, store };
    };
    const first = await launch();
    await first.session.pair({ key, relayUrl: relay });
    await first.session.refresh();
    assert.equal(reads, 2);
    assert.deepEqual(first.store.ids().sort(), ['m-1', 'm-2']);

    const second = await launch();
    await second.session.refresh();
    assert.equal(reads, 2);
    assert.deepEqual(second.store.ids().sort(), ['m-1', 'm-2']);

    await publishFromComputer(key, transport, [
      createDocument(startMeeting('m-2', 'Retro, renamed', 2_000)),
    ]);
    await second.session.refresh();
    assert.equal(reads, 3);
  });
});

describe('sharing on the phone', () => {
  it('learns the vault with sync, syncs the shares list beside meetings and runs the shared vaults after each round', async () => {
    const key = randomKey();
    const { transport } = memoryRelay();
    const seen: Array<string | null> = [];
    const rounds: string[] = [];
    let sharesRounds = 0;
    const sharesEngine = createSyncEngine({
      transport,
      vault: { id: vaultIdOf(key), key, deviceId: 'shares' },
      store: {
        ids: () => [],
        document: () => undefined,
        merge: () => ({
          state: null,
          written: Promise.resolve(null),
          kept: false,
        }),
      },
      onRemote: () => {},
      now: () => 1,
    });
    const store = createMeetingStore({
      files: memoryFiles(),
      cipher: async () => cipher,
    });
    await store.load();
    let saved: StoredVault | null = null;
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
      sharing: {
        load: async (vault) => {
          seen.push(vault ? vault.deviceId : null);
        },
        sharesEngine: async () => {
          sharesRounds += 1;
          return sharesEngine;
        },
        round: async (place) => {
          rounds.push(place?.name ?? 'none');
        },
        endAll: async () => {},
      },
      sharedPlaceFor: (vault) => ({
        name: vault.relayUrl,
        open: async () => transport,
      }),
    });
    await session.load();
    assert.deepEqual(seen, [null]);

    await session.pair({ key, relayUrl: relay });
    await session.refresh();
    assert.deepEqual(seen, [null, 'phone-1']);
    assert.equal(sharesRounds, 1);
    // Pairing runs a round of its own before the one asked for.
    assert.deepEqual(rounds, [relay, relay]);

    await session.unpair();
    assert.deepEqual(seen, [null, 'phone-1', null]);
    await session.refresh();
    assert.deepEqual(rounds, [relay, relay]);
  });
});
