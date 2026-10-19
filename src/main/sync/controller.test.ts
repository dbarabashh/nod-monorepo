import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createRelay } from '../../../relay/server.ts';
import {
  keyFromRecoveryPhrase,
  randomKey,
  recoveryPhrase,
  relayToken,
  vaultIdOf,
} from '../../core/crypto/index.ts';
import {
  setSummary,
  startMeeting,
  type DocumentState,
} from '../../core/meetings/index.ts';
import { createMeetingStore } from '../meetings/store.ts';
import type { KeyWrap } from '../security/data-key.ts';
import { useTempDir } from '../testing/temp-dir.ts';
import { createSyncController, UnreachableError } from './controller.ts';
import { createRelayTransport, type Fetch } from './relay-transport.ts';
import { createSyncSettings } from './settings.ts';

const reversing: KeyWrap = {
  wrap: (plain) => Buffer.from(plain).reverse(),
  unwrap: (data) => Buffer.from(data).reverse().toString(),
};

describe('sync controller', () => {
  const dir = useTempDir('sync-controller-');

  async function device(
    name: string,
    options: { defaultRelay?: string; fetch?: Fetch } = {},
  ) {
    const store = createMeetingStore({
      directory: join(dir(), name, 'meetings'),
      cipher: async () => ({
        encrypt: (plain) => Buffer.from(plain),
        decrypt: (data) => data,
      }),
    });
    await store.load();
    const received: DocumentState[] = [];
    const controller = createSyncController({
      settings: createSyncSettings({
        directory: join(dir(), name),
        keychain: reversing,
      }),
      store,
      onRemote: (state) => received.push(state),
      fetch: options.fetch ?? ((url, init) => fetch(url, init)),
      newId: randomUUID,
      now: () => 7,
      onChange: () => {},
      defaultRelay: options.defaultRelay ?? null,
    });
    await controller.load();
    return { store, controller, received };
  }

  async function startRelay(port = 0) {
    const server = createRelay(join(dir(), 'relay'));
    await new Promise<void>((resolve) =>
      server.listen(port, '127.0.0.1', resolve),
    );
    const address: AddressInfo | string | null = server.address();
    const bound = typeof address === 'object' && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${bound}`, port: bound };
  }

  async function meetingFiles(shared: string, phrase: string) {
    const devices = join(
      shared,
      'nod-sync',
      vaultIdOf(keyFromRecoveryPhrase(phrase)),
      'devices',
    );
    const [deviceId] = await readdir(devices);
    const folder = join(devices, deviceId ?? '', 'meetings');
    return { folder, files: await readdir(folder) };
  }

  function withoutCode(value: object) {
    const { vaultCode, ...rest } = Object(value);
    assert.match(String(vaultCode), /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    return rest;
  }

  async function sharedFolder() {
    const shared = join(dir(), 'shared');
    await mkdir(shared, { recursive: true });
    return shared;
  }

  it('keeps a new key on this device until a place to sync through is chosen', async () => {
    const laptop = await device('laptop', {
      defaultRelay: 'https://relay.example.com',
    });
    assert.deepEqual(laptop.controller.state(), {
      status: 'none',
      error: null,
    });

    await laptop.controller.create();

    const phrase = laptop.controller.recoveryPhrase();
    assert.deepEqual(laptop.controller.state(), {
      status: 'ready',
      vaultId: vaultIdOf(keyFromRecoveryPhrase(phrase)),
      transport: null,
      defaultRelay: 'https://relay.example.com',
      connected: false,
      devices: 0,
      lastSyncedAt: null,
      error: null,
      recoveryConfirmed: false,
    });
    assert.equal((await device('laptop')).controller.recoveryPhrase(), phrase);
    await assert.rejects(laptop.controller.create(), /already has/);
  });

  it('syncs two devices that entered the same words, each through the folder it chose', async () => {
    const shared = await sharedFolder();
    const laptop = await device('laptop');
    await laptop.controller.create();
    await laptop.store.save(
      setSummary(startMeeting('m1', 'Launch', 0), 'Ship Friday.'),
    );
    await laptop.controller.useFolder(shared);
    await laptop.controller.refresh();

    const desktop = await device('desktop');
    await desktop.controller.enterPhrase(laptop.controller.recoveryPhrase(), {
      leaveCopies: false,
      replaceUnreadable: false,
    });
    await desktop.controller.useFolder(shared);
    await desktop.controller.refresh();

    assert.deepEqual(
      desktop.received.map((state) => state.id),
      ['m1'],
    );
    const state = desktop.controller.state();
    assert.equal(state.status, 'ready');
    assert.equal(state.status === 'ready' && state.devices, 1);
    assert.equal(state.status === 'ready' && state.recoveryConfirmed, true);
  });

  it('never mixes meetings of two keys that share one folder', async () => {
    const shared = await sharedFolder();
    const laptop = await device('laptop');
    await laptop.controller.create();
    await laptop.store.save(startMeeting('m1', 'Mine', 0));
    await laptop.controller.useFolder(shared);
    await laptop.controller.refresh();

    const stranger = await device('stranger');
    await stranger.controller.create();
    await stranger.controller.useFolder(shared);
    await stranger.controller.refresh();

    assert.deepEqual(stranger.received, []);
    const state = stranger.controller.state();
    assert.equal(state.status === 'ready' && state.devices, 0);
  });

  it('tells before switching whether anyone syncs with the words entered', async () => {
    const shared = await sharedFolder();
    const laptop = await device('laptop');
    await laptop.controller.create();
    await laptop.store.save(startMeeting('m1', 'Laptop', 0));
    await laptop.controller.useFolder(shared);
    await laptop.controller.refresh();

    const fresh = await device('fresh');
    assert.deepEqual(
      withoutCode(
        await fresh.controller.preview(laptop.controller.recoveryPhrase()),
      ),
      { switching: false, replacing: false, reachable: true, devices: null },
    );

    const desktop = await device('desktop');
    await desktop.controller.create();
    await desktop.controller.useFolder(shared);
    assert.deepEqual(
      withoutCode(
        await desktop.controller.preview(laptop.controller.recoveryPhrase()),
      ),
      { switching: true, replacing: false, reachable: true, devices: 1 },
    );
    assert.deepEqual(
      withoutCode(
        await desktop.controller.preview(recoveryPhrase(randomKey())),
      ),
      { switching: true, replacing: false, reachable: true, devices: 0 },
    );
    await assert.rejects(
      desktop.controller.preview(desktop.controller.recoveryPhrase()),
      /already uses/,
    );
    await assert.rejects(desktop.controller.preview('one two'), /not right/);

    await rm(shared, { recursive: true });
    assert.deepEqual(
      withoutCode(
        await desktop.controller.preview(laptop.controller.recoveryPhrase()),
      ),
      { switching: true, replacing: false, reachable: false, devices: null },
    );
  });

  it('moves this device into the vault of other words, taking its meetings along', async () => {
    const shared = await sharedFolder();
    const laptop = await device('laptop');
    await laptop.controller.create();
    await laptop.store.save(startMeeting('m1', 'Laptop', 0));
    await laptop.controller.useFolder(shared);
    await laptop.controller.refresh();

    const desktop = await device('desktop');
    await desktop.controller.create();
    await desktop.store.save(startMeeting('m2', 'Desktop', 0));
    await desktop.controller.useFolder(shared);
    await desktop.controller.refresh();
    const own = await meetingFiles(shared, desktop.controller.recoveryPhrase());
    assert.deepEqual(own.files, ['m2.bin']);

    await desktop.controller.enterPhrase(laptop.controller.recoveryPhrase(), {
      leaveCopies: false,
      replaceUnreadable: false,
    });
    await desktop.controller.refresh();
    await laptop.controller.refresh();

    assert.deepEqual(await readdir(own.folder), []);
    assert.deepEqual(
      desktop.received.map((state) => state.id),
      ['m1'],
    );
    assert.deepEqual(
      laptop.received.map((state) => state.id),
      ['m2'],
    );
  });

  it('refuses to switch while the place can’t be reached, unless copies may stay', async () => {
    const shared = await sharedFolder();
    const desktop = await device('desktop');
    await desktop.controller.create();
    await desktop.controller.useFolder(shared);
    const phrase = desktop.controller.recoveryPhrase();
    await rm(shared, { recursive: true });
    const other = recoveryPhrase(randomKey());

    await assert.rejects(
      desktop.controller.enterPhrase(other, {
        leaveCopies: false,
        replaceUnreadable: false,
      }),
      UnreachableError,
    );
    assert.equal(desktop.controller.recoveryPhrase(), phrase);

    await desktop.controller.enterPhrase(other, {
      leaveCopies: true,
      replaceUnreadable: false,
    });
    assert.equal(desktop.controller.recoveryPhrase(), other);
    assert.equal((await device('desktop')).controller.recoveryPhrase(), other);
  });

  it('refuses words that are not a recovery phrase and changes nothing', async () => {
    const laptop = await device('laptop');
    await laptop.controller.create();
    const phrase = laptop.controller.recoveryPhrase();

    await assert.rejects(
      laptop.controller.enterPhrase('one two three', {
        leaveCopies: false,
        replaceUnreadable: false,
      }),
      /not right/,
    );

    assert.equal(laptop.controller.recoveryPhrase(), phrase);
    assert.equal((await device('laptop')).controller.recoveryPhrase(), phrase);
  });

  it('never replaces a key it could not read', async () => {
    const laptop = await device('laptop');
    await laptop.controller.create();
    const settingsFile = join(dir(), 'laptop', 'sync.json');
    const saved: unknown = JSON.parse(await readFile(settingsFile, 'utf8'));
    await writeFile(
      settingsFile,
      JSON.stringify({ ...Object(saved), key: 'AAAA' }),
    );
    const damaged = await readFile(settingsFile, 'utf8');

    const reopened = await device('laptop');
    assert.equal(reopened.controller.state().status, 'unavailable');
    await assert.rejects(reopened.controller.create(), /couldn’t be read/);
    await assert.rejects(
      reopened.controller.enterPhrase(recoveryPhrase(randomKey()), {
        leaveCopies: false,
        replaceUnreadable: false,
      }),
      /couldn’t be read/,
    );
    assert.equal(await readFile(settingsFile, 'utf8'), damaged);

    const phrase = recoveryPhrase(randomKey());
    assert.deepEqual(withoutCode(await reopened.controller.preview(phrase)), {
      switching: false,
      replacing: true,
      reachable: true,
      devices: null,
    });
    await reopened.controller.enterPhrase(phrase, {
      leaveCopies: false,
      replaceUnreadable: true,
    });
    assert.equal(reopened.controller.state().status, 'ready');
    assert.equal((await device('laptop')).controller.recoveryPhrase(), phrase);
  });

  it('removes what this device published when it stops, but keeps deletions and the key', async () => {
    const shared = await sharedFolder();
    const laptop = await device('laptop');
    await laptop.controller.create();
    await laptop.store.save(startMeeting('m1', 'Kept', 0));
    await laptop.store.save(startMeeting('m2', 'Deleted', 0));
    await laptop.store.remove('m2', 5);
    await laptop.controller.useFolder(shared);
    await laptop.controller.refresh();
    const phrase = laptop.controller.recoveryPhrase();
    const { folder, files } = await meetingFiles(shared, phrase);
    assert.deepEqual(files, ['m1.bin', 'm2.bin']);

    await laptop.controller.disconnect(false);
    await laptop.controller.refresh();

    assert.deepEqual(await readdir(folder), ['m2.bin']);
    const reopened = (await device('laptop')).controller;
    const state = reopened.state();
    assert.equal(state.status === 'ready' && state.transport, null);
    assert.equal(reopened.recoveryPhrase(), phrase);
  });

  it('stops only with the user’s consent when the place is gone', async () => {
    const shared = await sharedFolder();
    const laptop = await device('laptop');
    await laptop.controller.create();
    await laptop.controller.useFolder(shared);
    await rm(shared, { recursive: true });
    const reopened = await device('laptop');
    await assert.rejects(
      reopened.controller.useFolder(dir()),
      /Stop syncing before/,
    );

    await assert.rejects(
      reopened.controller.disconnect(false),
      UnreachableError,
    );
    const kept = reopened.controller.state();
    assert.deepEqual(kept.status === 'ready' && kept.transport, {
      kind: 'folder',
      folder: shared,
    });

    await reopened.controller.disconnect(true);
    const stopped = (await device('laptop')).controller.state();
    assert.equal(stopped.status === 'ready' && stopped.transport, null);
  });

  it('keeps the place and publishes everything again when files could not be removed', async () => {
    const shared = await sharedFolder();
    const laptop = await device('laptop');
    await laptop.controller.create();
    await laptop.store.save(startMeeting('m1', 'First', 0));
    await laptop.store.save(startMeeting('m2', 'Second', 0));
    await laptop.controller.useFolder(shared);
    await laptop.controller.refresh();
    const { folder } = await meetingFiles(
      shared,
      laptop.controller.recoveryPhrase(),
    );
    await rm(join(folder, 'm2.bin'));
    await mkdir(join(folder, 'm2.bin', 'blocker'), { recursive: true });

    await assert.rejects(laptop.controller.disconnect(false));
    await rm(join(folder, 'm2.bin'), { recursive: true });
    await laptop.controller.refresh();

    assert.deepEqual(await readdir(folder), ['m1.bin', 'm2.bin']);
    const state = laptop.controller.state();
    assert.equal(state.status === 'ready' && state.connected, true);
  });

  it('stays stopped when a connection that was opening finishes after the user stopped', async () => {
    const { server, url } = await startRelay();
    try {
      const laptop = await device('laptop');
      await laptop.controller.create();
      await laptop.controller.useRelay(url);
      const key = keyFromRecoveryPhrase(laptop.controller.recoveryPhrase());

      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const slow = await device('laptop', {
        fetch: async (input, init) => {
          if (init.method === 'PUT' && !input.includes('/files/')) {
            await held;
          }
          return fetch(input, init);
        },
      });
      const round = slow.controller.refresh();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const stop = slow.controller.disconnect(false);
      release();
      await Promise.all([round, stop]);
      await slow.store.save(startMeeting('m1', 'After stopping', 0));
      await slow.controller.refresh();

      const state = slow.controller.state();
      assert.equal(state.status === 'ready' && state.connected, false);
      const relay = createRelayTransport({
        url,
        vaultId: vaultIdOf(key),
        token: relayToken(key),
        fetch: (input, init) => fetch(input, init),
      });
      assert.deepEqual(await relay.list('devices/'), []);
    } finally {
      server.close();
    }
  });

  it('starts no sync round while the user is stopping', async () => {
    const { server, url } = await startRelay();
    try {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding = false;
      const laptop = await device('laptop', {
        fetch: async (input, init) => {
          if (holding && init.method === 'DELETE') {
            await held;
          }
          return fetch(input, init);
        },
      });
      await laptop.controller.create();
      await laptop.store.save(startMeeting('m1', 'Launch', 0));
      await laptop.controller.useRelay(url);
      await laptop.controller.refresh();
      const key = keyFromRecoveryPhrase(laptop.controller.recoveryPhrase());

      holding = true;
      const stop = laptop.controller.disconnect(false);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const round = laptop.controller.refresh();
      await new Promise((resolve) => setTimeout(resolve, 20));
      release();
      await Promise.all([stop, round]);
      await laptop.store.save(startMeeting('m2', 'After stopping', 0));
      await laptop.controller.refresh();

      const relay = createRelayTransport({
        url,
        vaultId: vaultIdOf(key),
        token: relayToken(key),
        fetch: (input, init) => fetch(input, init),
      });
      assert.deepEqual(await relay.list('devices/'), []);
    } finally {
      server.close();
    }
  });

  it('lets a round that is publishing finish before removing what it published', async () => {
    const { server, url } = await startRelay();
    try {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let publishing = () => {};
      const reached = new Promise<void>((resolve) => {
        publishing = resolve;
      });
      let holding = false;
      const laptop = await device('laptop', {
        fetch: async (input, init) => {
          if (holding && init.method === 'PUT' && input.includes('/files/')) {
            holding = false;
            publishing();
            await held;
          }
          return fetch(input, init);
        },
      });
      await laptop.controller.create();
      await laptop.controller.useRelay(url);
      const key = keyFromRecoveryPhrase(laptop.controller.recoveryPhrase());
      await laptop.store.save(startMeeting('m1', 'Launch', 0));

      holding = true;
      const round = laptop.controller.refresh();
      await reached;
      const stop = laptop.controller.disconnect(false);
      await new Promise((resolve) => setTimeout(resolve, 20));
      release();
      await Promise.all([round, stop]);

      const relay = createRelayTransport({
        url,
        vaultId: vaultIdOf(key),
        token: relayToken(key),
        fetch: (input, init) => fetch(input, init),
      });
      assert.deepEqual(await relay.list('devices/'), []);
    } finally {
      server.close();
    }
  });

  it('reaches the relay once it is back online, and syncs then', async () => {
    const first = await startRelay();
    const laptop = await device('laptop');
    await laptop.controller.create();
    await laptop.controller.useRelay(first.url);
    const desktop = await device('desktop');
    await desktop.controller.enterPhrase(laptop.controller.recoveryPhrase(), {
      leaveCopies: false,
      replaceUnreadable: false,
    });
    await desktop.controller.useRelay(first.url);
    first.server.close();
    await laptop.store.save(startMeeting('m1', 'Offline', 0));

    const restarted = await device('desktop');
    await restarted.controller.refresh();
    const offline = restarted.controller.state();
    assert.equal(offline.status === 'ready' && offline.connected, false);
    assert.equal(offline.status === 'ready' && offline.error, 'fetch failed');

    const again = await startRelay(first.port);
    try {
      await laptop.controller.refresh();
      await restarted.controller.refresh();
      assert.deepEqual(
        restarted.received.map((state) => state.id),
        ['m1'],
      );
      const online = restarted.controller.state();
      assert.equal(online.status === 'ready' && online.error, null);
    } finally {
      again.server.close();
    }
  });

  it('changes one thing at a time when asked twice at the same moment', async () => {
    const first = join(dir(), 'first');
    const second = join(dir(), 'second');
    await mkdir(first);
    await mkdir(second);
    const laptop = await device('laptop');
    await laptop.controller.create();
    const results = await Promise.allSettled([
      laptop.controller.useFolder(first),
      laptop.controller.useFolder(second),
    ]);
    assert.equal(results[0]?.status, 'fulfilled');
    assert.match(
      results[1]?.status === 'rejected' ? String(results[1].reason) : '',
      /busy/,
    );
    const state = (await device('laptop')).controller.state();
    assert.deepEqual(state.status === 'ready' && state.transport, {
      kind: 'folder',
      folder: first,
    });
  });

  it('asks to write a new phrase down, once, but not words that were entered', async () => {
    const owner = await device('owner');
    await owner.controller.create();
    await owner.controller.confirmRecoveryPhrase();
    const reopened = (await device('owner')).controller.state();
    assert.equal(
      reopened.status === 'ready' && reopened.recoveryConfirmed,
      true,
    );

    const entered = await device('entered');
    await entered.controller.enterPhrase(recoveryPhrase(randomKey()), {
      leaveCopies: false,
      replaceUnreadable: false,
    });
    const state = entered.controller.state();
    assert.equal(state.status === 'ready' && state.recoveryConfirmed, true);
  });
});
