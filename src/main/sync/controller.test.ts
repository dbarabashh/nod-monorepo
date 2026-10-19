import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createRelay } from '../../../relay/server.ts';
import { randomKey, recoveryPhrase } from '../../core/crypto/index.ts';
import {
  setSummary,
  startMeeting,
  type DocumentState,
} from '../../core/meetings/index.ts';
import { createMeetingStore } from '../meetings/store.ts';
import type { KeyWrap } from '../security/data-key.ts';
import { useTempDir } from '../testing/temp-dir.ts';
import { createSyncController } from './controller.ts';
import { createSyncSettings } from './settings.ts';

const reversing: KeyWrap = {
  wrap: (plain) => Buffer.from(plain).reverse(),
  unwrap: (data) => Buffer.from(data).reverse().toString(),
};

describe('sync controller', () => {
  const dir = useTempDir('sync-controller-');

  async function device(name: string) {
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
      fetch: (url, init) => fetch(url, init),
      newId: randomUUID,
      now: () => 7,
      onChange: () => {},
    });
    await controller.load();
    return { store, controller, received };
  }

  it('lets a second device join through the same folder after the codes match', async () => {
    const shared = join(dir(), 'shared');
    const laptop = await device('laptop');
    const phone = await device('phone');
    await laptop.store.save(
      setSummary(startMeeting('m1', 'Launch', 0), 'Ship Friday.'),
    );

    await laptop.controller.useFolder(shared);
    assert.equal(laptop.controller.state().status, 'on');
    await phone.controller.useFolder(shared);
    assert.deepEqual(phone.controller.state(), {
      status: 'joining',
      transport: { kind: 'folder', folder: shared },
      code: null,
      confirmed: false,
    });

    await laptop.controller.refresh();
    await phone.controller.refresh();
    await laptop.controller.refresh();
    const phoneState = phone.controller.state();
    const laptopState = laptop.controller.state();
    assert.equal(phoneState.status, 'joining');
    assert.equal(laptopState.status, 'on');
    const request =
      laptopState.status === 'on' ? laptopState.requests[0] : undefined;
    assert.equal(
      request?.code,
      phoneState.status === 'joining' ? phoneState.code : undefined,
    );

    await phone.controller.confirmJoin(request?.code ?? '');
    await laptop.controller.approve(
      request?.requestId ?? '',
      request?.code ?? '',
    );
    await phone.controller.refresh();
    const joined = phone.controller.state();
    assert.equal(joined.status, 'on');
    assert.equal(
      joined.status === 'on' ? joined.vaultId : '',
      laptopState.status === 'on' ? laptopState.vaultId : 'x',
    );
    await phone.controller.refresh();
    assert.deepEqual(
      phone.received.map((state) => state.id),
      ['m1'],
    );

    const reopened = await device('phone');
    assert.equal(reopened.controller.state().status, 'on');
  });

  it('removes what this device published when sync is turned off', async () => {
    const shared = join(dir(), 'shared');
    const laptop = await device('laptop');
    await laptop.store.save(startMeeting('m1', 'Launch', 0));
    await laptop.controller.useFolder(shared);
    await laptop.controller.refresh();
    const devices = join(shared, 'nod-sync', 'devices');
    const [deviceId] = await readdir(devices);
    assert.deepEqual(await readdir(join(devices, deviceId ?? '', 'meetings')), [
      'm1.bin',
    ]);

    await laptop.controller.stop();

    assert.deepEqual(
      await readdir(join(devices, deviceId ?? '', 'meetings')),
      [],
    );
    assert.deepEqual(laptop.controller.state(), { status: 'off', error: null });
    assert.equal((await device('laptop')).controller.state().status, 'off');
  });

  it('keeps published deletions when sync is turned off, so other devices still get them', async () => {
    const shared = join(dir(), 'shared');
    const laptop = await device('laptop');
    await laptop.store.save(startMeeting('m1', 'Kept', 0));
    await laptop.store.save(startMeeting('m2', 'Deleted', 0));
    await laptop.store.remove('m2', 5);
    await laptop.controller.useFolder(shared);
    await laptop.controller.refresh();
    const devices = join(shared, 'nod-sync', 'devices');
    const [deviceId] = await readdir(devices);

    await laptop.controller.stop();

    assert.deepEqual(await readdir(join(devices, deviceId ?? '', 'meetings')), [
      'm2.bin',
    ]);
  });

  it('keeps syncing, key and all, when this device’s files could not be removed', async () => {
    const shared = join(dir(), 'shared');
    const laptop = await device('laptop');
    await laptop.store.save(startMeeting('m1', 'Launch', 0));
    await laptop.controller.useFolder(shared);
    await laptop.controller.refresh();
    const devices = join(shared, 'nod-sync', 'devices');
    const [deviceId] = await readdir(devices);
    const published = join(devices, deviceId ?? '', 'meetings', 'm1.bin');
    await rm(published);
    await mkdir(join(published, 'blocker'), { recursive: true });

    await assert.rejects(laptop.controller.stop());

    assert.equal(laptop.controller.state().status, 'on');
    assert.equal((await device('laptop')).controller.state().status, 'on');
  });

  async function phraseOf(
    controller: Awaited<ReturnType<typeof device>>['controller'],
  ) {
    return controller.recoveryPhrase();
  }

  it('restores sync on a new device from the recovery phrase alone', async () => {
    const shared = join(dir(), 'shared');
    const lost = await device('lost');
    await lost.store.save(
      setSummary(startMeeting('m1', 'Launch', 0), 'Ship Friday.'),
    );
    await lost.controller.useFolder(shared);
    await lost.controller.refresh();
    const phrase = await phraseOf(lost.controller);
    const before = lost.controller.state();

    const fresh = await device('fresh');
    await fresh.controller.restoreFromFolder(shared, phrase);
    await fresh.controller.refresh();

    const after = fresh.controller.state();
    assert.equal(after.status, 'on');
    assert.equal(
      after.status === 'on' ? after.vaultId : '',
      before.status === 'on' ? before.vaultId : 'x',
    );
    assert.deepEqual(
      fresh.received.map((state) => state.id),
      ['m1'],
    );
  });

  it('refuses a phrase from another vault, and a folder with nothing to restore', async () => {
    const shared = join(dir(), 'shared');
    const owner = await device('owner');
    await owner.store.save(startMeeting('m1', 'Launch', 0));
    await owner.controller.useFolder(shared);
    await owner.controller.refresh();

    const fresh = await device('fresh');
    await assert.rejects(
      fresh.controller.restoreFromFolder(shared, recoveryPhrase(randomKey())),
      /different vault/,
    );
    await assert.rejects(
      fresh.controller.restoreFromFolder(
        join(dir(), 'empty'),
        recoveryPhrase(randomKey()),
      ),
      /no synced meetings/,
    );
    assert.equal(fresh.controller.state().status, 'off');
    assert.equal((await device('fresh')).controller.state().status, 'off');
  });

  it('restores from a relay only with the right phrase and vault', async () => {
    const server = createRelay(join(dir(), 'relay'));
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address: AddressInfo | string | null = server.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    try {
      const owner = await device('owner');
      await owner.store.save(startMeeting('m1', 'Launch', 0));
      await owner.controller.useRelay(url, null);
      await owner.controller.refresh();
      const state = owner.controller.state();
      const vaultId = state.status === 'on' ? state.vaultId : '';

      const fresh = await device('fresh');
      await assert.rejects(
        fresh.controller.restoreFromRelay(
          url,
          vaultId,
          recoveryPhrase(randomKey()),
        ),
        /different vault/,
      );
      await assert.rejects(
        fresh.controller.restoreFromRelay(
          url,
          'no-such-vault',
          await phraseOf(owner.controller),
        ),
        /no vault with that ID/,
      );
      await fresh.controller.restoreFromRelay(
        url,
        vaultId,
        await phraseOf(owner.controller),
      );
      await fresh.controller.refresh();
      assert.deepEqual(
        fresh.received.map((received) => received.id),
        ['m1'],
      );
    } finally {
      server.close();
    }
  });

  it('checks a phrase even before the vault holds any meeting', async () => {
    const shared = join(dir(), 'shared');
    const owner = await device('owner');
    await owner.controller.useFolder(shared);
    const phrase = owner.controller.recoveryPhrase();

    const fresh = await device('fresh');
    await assert.rejects(
      fresh.controller.restoreFromFolder(shared, recoveryPhrase(randomKey())),
      /different vault/,
    );
    await fresh.controller.restoreFromFolder(shared, phrase);
    assert.equal(fresh.controller.state().status, 'on');
  });

  it('sets up only once when asked twice at the same moment', async () => {
    const laptop = await device('laptop');
    const results = await Promise.allSettled([
      laptop.controller.useFolder(join(dir(), 'first')),
      laptop.controller.useFolder(join(dir(), 'second')),
    ]);
    assert.deepEqual(
      results.map((result) => result.status),
      ['fulfilled', 'rejected'],
    );
  });

  it('asks the first device to write the phrase down, once', async () => {
    const shared = join(dir(), 'shared');
    const owner = await device('owner');
    await owner.controller.useFolder(shared);
    const fresh = owner.controller.state();
    assert.equal(fresh.status === 'on' && fresh.recoveryConfirmed, false);

    await owner.controller.confirmRecoveryPhrase();

    const reopened = (await device('owner')).controller.state();
    assert.equal(reopened.status === 'on' && reopened.recoveryConfirmed, true);

    const restored = await device('restored');
    await restored.controller.restoreFromFolder(
      shared,
      owner.controller.recoveryPhrase(),
    );
    const state = restored.controller.state();
    assert.equal(state.status === 'on' && state.recoveryConfirmed, true);
  });
});
