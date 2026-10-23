import { strict as assert } from 'node:assert';
import { randomBytes, randomUUID } from 'node:crypto';
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
} from '@nod/core/crypto';
import {
  setSummary,
  startMeeting,
  type DocumentState,
} from '@nod/core/meetings';
import { createMeetingStore } from '../meetings/store.ts';
import type { KeyWrap } from '../security/data-key.ts';
import { useTempDir } from '../testing/temp-dir.ts';
import { createSyncController, UnreachableError } from './controller.ts';
import type { SyncState } from '../../shared/ipc.ts';
import { createRelayTransport, type Fetch } from '@nod/core/sync';
import { createSyncSettings } from './settings.ts';
import { createPublishedLogs, type PublishedLogs } from './published-log.ts';

const reversing: KeyWrap = {
  wrap: (plain) => Buffer.from(plain).reverse(),
  unwrap: (data) => Buffer.from(data).reverse().toString(),
};

describe('sync controller', () => {
  const dir = useTempDir('sync-controller-');

  async function device(
    name: string,
    options: {
      defaultRelay?: string;
      fetch?: Fetch;
      savesFail?: () => boolean;
      now?: () => number;
      publishedLogs?: PublishedLogs;
      sharing?: NonNullable<
        Parameters<typeof createSyncController>[0]['sharing']
      >;
    } = {},
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
    const settings = createSyncSettings({
      directory: join(dir(), name),
      keychain: reversing,
    });
    const controller = createSyncController({
      settings: {
        load: settings.load,
        save: (vault) =>
          options.savesFail?.()
            ? Promise.reject(new Error('disk full'))
            : settings.save(vault),
      },
      store,
      onRemote: (state) => received.push(state),
      fetch: options.fetch ?? ((url, init) => fetch(url, init)),
      newId: randomUUID,
      now: options.now ?? (() => 7),
      onChange: () => {},
      defaultRelay: options.defaultRelay ?? null,
      publishedLogs: options.publishedLogs,
      sharing: options.sharing,
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
      closed: false,
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

  it('forgets a device after a relaunch on what its log says it merged, and only then', async () => {
    const shared = await sharedFolder();
    const laptop = await device('laptop');
    await laptop.controller.create();
    await laptop.controller.useFolder(shared);
    const words = laptop.controller.recoveryPhrase();
    const joinVault = async (name: string, publishedLogs?: PublishedLogs) => {
      const next = await device(name, { publishedLogs });
      await next.controller.enterPhrase(words, {
        leaveCopies: false,
        replaceUnreadable: false,
      });
      await next.controller.useFolder(shared);
      return next;
    };
    const old = await joinVault('old-phone');
    await old.store.save(startMeeting('m2', 'Only on the old phone', 1));
    await old.controller.refresh();
    const tablet = await joinVault('tablet');
    await tablet.store.save(startMeeting('m3', 'Only on the tablet', 2));
    await tablet.store.save(startMeeting('m5', 'Also on the tablet', 2));
    await tablet.controller.refresh();
    const logFile = join(dir(), 'desktop-published');
    const logs = createPublishedLogs(logFile, 0);
    const desktop = await joinVault('desktop', logs);
    await desktop.controller.refresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await logs.flushed();
    const seen = await desktop.controller.devices();
    const oldId = seen.find((entry) => entry.meetings === 1)?.id;
    const tabletId = seen.find((entry) => entry.meetings === 2)?.id;
    assert.ok(oldId && tabletId);
    await tablet.store.save(startMeeting('m4', 'Written since', 3));
    await tablet.controller.refresh();

    const relaunched = await device('desktop', {
      publishedLogs: createPublishedLogs(logFile, 0),
    });
    await assert.rejects(
      relaunched.controller.forgetDevice(tabletId),
      /haven’t reached this computer/,
    );
    // Forgetting runs a round first, which brings m4 along; the copy of m2
    // only the old phone had is now this computer's.
    await relaunched.controller.forgetDevice(oldId);
    assert.deepEqual(relaunched.store.ids().sort(), ['m2', 'm3', 'm4', 'm5']);
    await laptop.controller.refresh();
    assert.deepEqual(
      (await laptop.controller.devices()).map((entry) => entry.meetings).sort(),
      [1, 3],
    );

    // The log still says m3 was merged, but a relaunch that lost the file
    // must not take its word for it.
    await rm(join(dir(), 'desktop', 'meetings', 'm3.bin'));
    const lostOne = await device('desktop', {
      publishedLogs: createPublishedLogs(logFile, 0),
    });
    assert.deepEqual(lostOne.store.ids().sort(), ['m2', 'm4', 'm5']);
    await assert.rejects(
      lostOne.controller.forgetDevice(tabletId),
      /haven’t reached this computer/,
    );
  });

  it('forgets a device that left copies, keeping in the vault what only it had', async () => {
    const shared = await sharedFolder();
    const laptop = await device('laptop');
    await laptop.controller.create();
    await laptop.store.save(startMeeting('m1', 'Launch', 0));
    await laptop.controller.useFolder(shared);
    await laptop.controller.refresh();
    const words = laptop.controller.recoveryPhrase();
    const join = async (name: string) => {
      const next = await device(name);
      await next.controller.enterPhrase(words, {
        leaveCopies: false,
        replaceUnreadable: false,
      });
      await next.controller.useFolder(shared);
      return next;
    };
    const old = await join('old-phone');
    await old.store.save(startMeeting('m2', 'Only on the old phone', 1));
    await old.store.save(startMeeting('m3', 'Also only there', 2));
    await old.controller.refresh();
    const desktop = await join('desktop');
    await desktop.controller.refresh();

    const before = await desktop.controller.devices();
    assert.deepEqual(before.map((entry) => entry.meetings).sort(), [1, 2]);
    const lost = before.find((entry) => entry.meetings === 2)?.id ?? '';
    await old.store.save(startMeeting('m4', 'Written after the last sync', 3));
    await old.controller.refresh();
    await assert.rejects(
      desktop.controller.forgetDevice(lost),
      /haven’t reached this computer/,
    );
    assert.deepEqual(
      (await desktop.controller.devices())
        .map((entry) => entry.meetings)
        .sort(),
      [1, 3],
    );
    await desktop.controller.refresh();
    await desktop.controller.forgetDevice(lost);

    // No sync round in between: the meetings only that device had must
    // already be in the vault under this computer.
    const after = await laptop.controller.devices();
    assert.equal(
      after.some((entry) => entry.id === lost),
      false,
    );
    assert.deepEqual(
      after.map((entry) => entry.meetings),
      [3],
    );
    await laptop.controller.refresh();
    assert.deepEqual(laptop.received.map((state) => state.id).sort(), [
      'm2',
      'm3',
      'm4',
    ]);
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
      {
        switching: false,
        replacing: false,
        reachable: true,
        waitMs: null,
        devices: null,
      },
    );

    const desktop = await device('desktop');
    await desktop.controller.create();
    await desktop.controller.useFolder(shared);
    assert.deepEqual(
      withoutCode(
        await desktop.controller.preview(laptop.controller.recoveryPhrase()),
      ),
      {
        switching: true,
        replacing: false,
        reachable: true,
        waitMs: null,
        devices: 1,
      },
    );
    assert.deepEqual(
      withoutCode(
        await desktop.controller.preview(recoveryPhrase(randomKey())),
      ),
      {
        switching: true,
        replacing: false,
        reachable: true,
        waitMs: null,
        devices: 0,
      },
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
      {
        switching: true,
        replacing: false,
        reachable: false,
        waitMs: null,
        devices: null,
      },
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
      waitMs: null,
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

  it('waits as long as a relay asked before trying to reach it again', async () => {
    const first = await startRelay();
    const laptop = await device('laptop');
    await laptop.controller.create();
    await laptop.controller.useRelay(first.url);
    first.server.close();

    const clock = { at: 1_000 };
    const requests: string[] = [];
    const restarted = await device('laptop', {
      now: () => clock.at,
      fetch: async (url, init) => {
        requests.push(`${init.method} ${new URL(url).pathname}`);
        return new Response(null, {
          status: 429,
          headers: { 'retry-after': '300' },
        });
      },
    });
    const shown = () => {
      const state = restarted.controller.state();
      return state.status === 'ready' ? state.error : null;
    };
    await restarted.controller.refresh();
    assert.equal(
      shown(),
      'The relay answered 429: it asked this device to wait, sync will try again in about 5 minutes',
    );
    assert.equal(requests.length, 1);
    assert.match(requests[0] ?? '', /^PUT \/v1\/vaults\//);

    clock.at = 1_000 + 120_000;
    await restarted.controller.refresh();
    assert.equal(requests.length, 1);
    assert.equal(
      shown(),
      'The relay answered 429: it asked this device to wait, sync will try again in about 3 minutes',
    );

    clock.at = 1_000 + 299_999;
    await restarted.controller.refresh();
    assert.equal(requests.length, 1);
    assert.equal(
      shown(),
      'The relay answered 429: it asked this device to wait, sync will try again in a moment',
    );

    clock.at = 1_000 + 300_000;
    await restarted.controller.refresh();
    assert.equal(requests.length, 2);

    clock.at = 1_000 + 310_000;
    await restarted.controller.confirmRecoveryPhrase();
    await restarted.controller.refresh();
    assert.equal(requests.length, 3);

    clock.at = 1_000 + 320_000;
    await restarted.controller.refresh();
    assert.equal(requests.length, 3);

    const askedToWait = (waitMs: number) => ({
      switching: true,
      replacing: false,
      reachable: false,
      waitMs,
      devices: null,
    });
    assert.deepEqual(
      withoutCode(
        await restarted.controller.preview(recoveryPhrase(randomKey())),
      ),
      askedToWait(290_000),
    );
    assert.equal(requests.length, 3);

    clock.at = 1_000 + 620_000;
    assert.deepEqual(
      withoutCode(
        await restarted.controller.preview(recoveryPhrase(randomKey())),
      ),
      askedToWait(300_000),
    );
    assert.equal(requests.length, 4);
    assert.match(requests[3] ?? '', /^GET /);

    clock.at = 1_000 + 630_000;
    await restarted.controller.refresh();
    assert.equal(requests.length, 4);
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
      /still finishing another change/,
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

  const savesFail = new Set<string>();

  async function syncedTrio(shared: string) {
    savesFail.clear();
    const laptop = await device('laptop');
    await laptop.controller.create();
    await laptop.store.save(startMeeting('m1', 'Before', 0));
    await laptop.controller.useFolder(shared);
    const phrase = laptop.controller.recoveryPhrase();
    const others = [];
    for (const name of ['desktop', 'tablet']) {
      const other = await device(name, {
        savesFail: () => savesFail.has(name),
      });
      await other.controller.enterPhrase(phrase, {
        leaveCopies: false,
        replaceUnreadable: false,
      });
      await other.controller.useFolder(shared);
      others.push(other);
    }
    for (const each of [laptop, ...others]) {
      await each.controller.refresh();
    }
    const [desktop, tablet] = others;
    assert.ok(desktop && tablet);
    return { laptop, desktop, tablet, phrase };
  }

  function closedOf(controller: { state: () => SyncState }) {
    const state = controller.state();
    return state.status === 'ready' && state.closed;
  }

  function oldVaultFiles(shared: string, phrase: string) {
    return readdir(
      join(shared, 'nod-sync', vaultIdOf(keyFromRecoveryPhrase(phrase))),
      { recursive: true },
    ).then((entries) => entries.map(String));
  }

  it('closes the old vault when the phrase changes; only devices given the new phrase sync again', async () => {
    const shared = await sharedFolder();
    const { laptop, desktop, tablet, phrase } = await syncedTrio(shared);

    await laptop.controller.changePhrase(false);
    const newPhrase = laptop.controller.recoveryPhrase();
    assert.notEqual(newPhrase, phrase);
    const changed = laptop.controller.state();
    assert.equal(
      changed.status === 'ready' && changed.recoveryConfirmed,
      false,
    );
    const files = await oldVaultFiles(shared, phrase);
    const notice = files.find((entry) => entry.endsWith('closed.json')) ?? '';
    const laptopDir = notice.replace(/closed\.json$/, '');
    assert.notEqual(notice, '');
    assert.deepEqual(
      files.filter(
        (entry) => entry.startsWith(laptopDir) && entry.endsWith('.bin'),
      ),
      [],
    );

    await desktop.store.save(startMeeting('m-late', 'After closing', 0));
    await desktop.controller.refresh();
    await tablet.controller.refresh();
    assert.equal(closedOf(desktop.controller), true);
    assert.equal(closedOf(tablet.controller), true);
    await desktop.controller.refresh();
    assert.equal(
      (await oldVaultFiles(shared, phrase)).some((entry) =>
        entry.endsWith('m-late.bin'),
      ),
      false,
    );

    await desktop.controller.enterPhrase(newPhrase, {
      leaveCopies: false,
      replaceUnreadable: false,
    });
    assert.equal(closedOf(desktop.controller), false);
    await laptop.store.save(startMeeting('m2', 'New', 0));
    await laptop.controller.refresh();
    await desktop.controller.refresh();
    await tablet.controller.refresh();
    assert.ok(desktop.received.some((state) => state.id === 'm2'));
    assert.equal(
      tablet.received.some((state) => state.id === 'm2'),
      false,
    );
  });

  it('stays stopped after a restart even if the notice was removed', async () => {
    const shared = await sharedFolder();
    const { laptop, desktop, phrase } = await syncedTrio(shared);
    await laptop.controller.changePhrase(false);
    await desktop.controller.refresh();
    assert.equal(closedOf(desktop.controller), true);

    const notices = (await oldVaultFiles(shared, phrase)).filter((entry) =>
      entry.endsWith('closed.json'),
    );
    for (const notice of notices) {
      await rm(
        join(
          shared,
          'nod-sync',
          vaultIdOf(keyFromRecoveryPhrase(phrase)),
          notice,
        ),
      );
    }
    const restarted = await device('desktop');
    await restarted.controller.refresh();
    assert.equal(closedOf(restarted.controller), true);
  });

  it('ignores a notice that doesn’t open with the vault key', async () => {
    const shared = await sharedFolder();
    const { desktop, phrase } = await syncedTrio(shared);
    const forged = join(
      shared,
      'nod-sync',
      vaultIdOf(keyFromRecoveryPhrase(phrase)),
      'devices',
      'intruder',
    );
    await mkdir(forged, { recursive: true });
    await writeFile(join(forged, 'closed.json'), randomBytes(200));
    await desktop.controller.refresh();
    assert.equal(closedOf(desktop.controller), false);
  });

  it('keeps the new phrase when the old vault can’t be told', async () => {
    const shared = await sharedFolder();
    const { laptop, phrase } = await syncedTrio(shared);
    await rm(join(shared, 'nod-sync'), { recursive: true });
    await writeFile(join(shared, 'nod-sync'), 'not a folder');

    await laptop.controller.changePhrase(false);

    assert.notEqual(laptop.controller.recoveryPhrase(), phrase);
    const after = laptop.controller.state();
    assert.match(
      after.status === 'ready' ? (after.error ?? '') : '',
      /weren’t told/,
    );
    const reopened = await device('laptop');
    assert.equal(
      reopened.controller.recoveryPhrase(),
      laptop.controller.recoveryPhrase(),
    );
    await laptop.controller.confirmRecoveryPhrase();
    const confirmed = laptop.controller.state();
    assert.match(
      confirmed.status === 'ready' ? (confirmed.error ?? '') : '',
      /weren’t told/,
    );
  });

  it('changes the phrase while the place is gone only when copies may stay', async () => {
    const shared = await sharedFolder();
    const { laptop, phrase } = await syncedTrio(shared);
    await rm(shared, { recursive: true });
    await assert.rejects(
      laptop.controller.changePhrase(false),
      UnreachableError,
    );
    assert.equal(laptop.controller.recoveryPhrase(), phrase);
    await laptop.controller.changePhrase(true);
    assert.notEqual(laptop.controller.recoveryPhrase(), phrase);
  });

  it('changes the phrase of a device that syncs nowhere', async () => {
    const laptop = await device('laptop');
    await laptop.controller.create();
    const phrase = laptop.controller.recoveryPhrase();
    await laptop.controller.changePhrase(false);
    assert.notEqual(laptop.controller.recoveryPhrase(), phrase);
  });

  it('stops at once when a notice arrives even if saving that fails, and saves it later', async () => {
    const shared = await sharedFolder();
    const { laptop, desktop, phrase } = await syncedTrio(shared);
    await laptop.controller.changePhrase(false);
    savesFail.add('desktop');
    await desktop.store.save(startMeeting('m-late', 'After closing', 0));

    await desktop.controller.refresh();

    assert.equal(closedOf(desktop.controller), true);
    assert.equal(
      (await oldVaultFiles(shared, phrase)).some((entry) =>
        entry.endsWith('m-late.bin'),
      ),
      false,
    );
    savesFail.delete('desktop');
    await desktop.controller.refresh();
    assert.equal(closedOf((await device('desktop')).controller), true);
  });

  it('isn’t blinded by a notice it can’t read, and doesn’t sync while one is unread', async () => {
    const shared = await sharedFolder();
    const { laptop, desktop, phrase } = await syncedTrio(shared);
    const junk = join(
      shared,
      'nod-sync',
      vaultIdOf(keyFromRecoveryPhrase(phrase)),
      'devices',
      '0000',
    );
    await mkdir(junk, { recursive: true });
    await writeFile(join(junk, 'closed.json'), randomBytes(64 * 1024));
    await desktop.store.save(startMeeting('m-held', 'Held back', 0));

    await desktop.controller.refresh();
    assert.equal(closedOf(desktop.controller), false);
    assert.equal(
      (await oldVaultFiles(shared, phrase)).some((entry) =>
        entry.endsWith('m-held.bin'),
      ),
      false,
    );
    const held = desktop.controller.state();
    assert.match(
      held.status === 'ready' ? (held.error ?? '') : '',
      /couldn’t be read/,
    );

    await laptop.controller.changePhrase(false);
    await desktop.controller.refresh();
    assert.equal(closedOf(desktop.controller), true);
  });

  it('lets a device closed by someone else make its own new phrase, and keeps it closed when sync stops', async () => {
    const shared = await sharedFolder();
    const { laptop, desktop, tablet, phrase } = await syncedTrio(shared);
    await tablet.controller.changePhrase(false);
    await desktop.controller.refresh();
    await laptop.controller.refresh();
    assert.equal(closedOf(desktop.controller), true);

    await laptop.controller.disconnect(false);
    assert.equal(closedOf(laptop.controller), true);
    assert.equal(closedOf((await device('laptop')).controller), true);

    await desktop.controller.changePhrase(false);
    assert.equal(closedOf(desktop.controller), false);
    assert.notEqual(desktop.controller.recoveryPhrase(), phrase);
    await desktop.store.save(startMeeting('m-own', 'Own phrase', 0));
    await desktop.controller.refresh();
    const state = desktop.controller.state();
    assert.equal(state.status === 'ready' && state.connected, true);
    assert.equal(state.status === 'ready' && state.lastSyncedAt, 7);
  });

  it('forgets a device that left a shares list, which nothing has to wait for', async () => {
    const shared = await sharedFolder();
    const laptop = await device('laptop');
    await laptop.controller.create();
    await laptop.controller.useFolder(shared);
    const words = laptop.controller.recoveryPhrase();
    const phone = await device('phone');
    await phone.controller.enterPhrase(words, {
      leaveCopies: false,
      replaceUnreadable: false,
    });
    await phone.controller.useFolder(shared);
    await phone.store.save(startMeeting('m1', 'On the phone', 1));
    await phone.controller.refresh();
    await laptop.controller.refresh();
    const seen = await laptop.controller.devices();
    const phoneId = seen[0]?.id ?? '';
    assert.equal(seen.length, 1);
    const phoneFolder = join(
      shared,
      'nod-sync',
      vaultIdOf(keyFromRecoveryPhrase(words)),
      'devices',
      phoneId,
    );
    await writeFile(join(phoneFolder, 'shares.bin'), 'not a readable list');
    await laptop.controller.refresh();

    await laptop.controller.forgetDevice(phoneId);
    assert.deepEqual(await readdir(phoneFolder), ['meetings']);
    assert.deepEqual(await readdir(join(phoneFolder, 'meetings')), []);
  });

  it('carries sharing along: the vault on load, the shares engine in its round, the shared vaults after it', async () => {
    const shared = await sharedFolder();
    const seen: Array<string | null> = [];
    const places: Array<string | null> = [];
    let listings = 0;
    const laptop = await device('laptop', {
      sharing: {
        load: async (vault) => {
          seen.push(vault ? vault.deviceId : null);
        },
        sharesEngine: async () => ({
          sync: async (listed?: unknown[]) => {
            listings += listed?.length ?? -1;
          },
          status: () => ({ lastSyncedAt: null, devices: 0, error: null }),
          merged: () => undefined,
          stop: () => {},
          forget: () => {},
        }),
        round: async (place) => {
          places.push(place?.name ?? null);
        },
        endAll: async () => {},
      },
    });
    assert.deepEqual(seen, [null]);
    await laptop.controller.create();
    assert.equal(seen.length, 2);
    assert.notEqual(seen[1], null);
    assert.equal(laptop.controller.sharedPlace(), null);

    await laptop.controller.useFolder(shared);
    assert.equal(laptop.controller.sharedPlace()?.name, shared);
    await laptop.controller.refresh();
    assert.deepEqual(places, [shared]);
    assert.equal(listings, 0);

    await laptop.controller.disconnect(false);
    assert.equal(laptop.controller.sharedPlace(), null);
    await laptop.controller.refresh();
    assert.deepEqual(places, [shared]);
  });
});
