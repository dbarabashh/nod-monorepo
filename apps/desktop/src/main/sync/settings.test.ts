import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { vaultIdOf } from '@nod/core/crypto';
import type { KeyWrap } from '../security/data-key.ts';
import { useTempDir } from '../testing/temp-dir.ts';
import { createSyncSettings, type Vault } from './settings.ts';

const reversing: KeyWrap = {
  wrap: (plain) => Buffer.from(plain).reverse(),
  unwrap: (data) => Buffer.from(data).reverse().toString(),
};

describe('sync settings', () => {
  const dir = useTempDir('sync-settings-');
  const vault = (transport: Vault['transport'] = null): Vault => {
    const key = randomBytes(32);
    return {
      id: vaultIdOf(key),
      key,
      deviceId: 'device-1',
      transport,
      recoveryConfirmed: false,
      closed: false,
    };
  };

  it('remembers the vault, keeping its key out of the settings file', async () => {
    const settings = createSyncSettings({
      directory: dir(),
      keychain: reversing,
    });
    const saved = vault({ kind: 'folder', folder: '/sync' });
    await settings.save(saved);
    assert.deepEqual(await settings.load(), saved);
    const local = vault();
    await settings.save(local);
    assert.deepEqual(await settings.load(), local);
    const plain = await readFile(join(dir(), 'sync.json'), 'utf8');
    assert.equal(
      plain.includes(Buffer.from(saved.key).toString('base64')),
      false,
    );
  });

  it('remembers the old key until the phrase change hands sharing over', async () => {
    const settings = createSyncSettings({
      directory: dir(),
      keychain: reversing,
    });
    const previous = randomBytes(32);
    const handing = {
      ...vault(),
      handingOver: { key: previous, deviceId: 'device-0' },
    };
    await settings.save(handing);
    assert.deepEqual(await settings.load(), handing);
    const plain = await readFile(join(dir(), 'sync.json'), 'utf8');
    assert.equal(plain.includes(previous.toString('base64')), false);
    const done = { ...handing, handingOver: null };
    await settings.save(done);
    assert.equal((await settings.load())?.handingOver, undefined);
  });

  it('keeps the vault readable when the old key beside it is damaged', async () => {
    const settings = createSyncSettings({
      directory: dir(),
      keychain: reversing,
    });
    const saved = vault();
    await settings.save({
      ...saved,
      handingOver: { key: randomBytes(32), deviceId: 'device-0' },
    });
    const file = join(dir(), 'sync.json');
    const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
    assert.ok(typeof raw === 'object' && raw !== null);
    await writeFile(
      file,
      JSON.stringify({
        ...raw,
        handingOver: { key: 'AAAA', deviceId: 'device-0' },
      }),
    );
    assert.deepEqual(await settings.load(), saved);
  });

  it('has no vault until one is saved', async () => {
    const settings = createSyncSettings({
      directory: dir(),
      keychain: reversing,
    });
    assert.equal(await settings.load(), null);
  });

  it('keeps the file whole when two saves overlap', async () => {
    const settings = createSyncSettings({
      directory: dir(),
      keychain: reversing,
    });
    const first = vault();
    const second = { ...vault(), recoveryConfirmed: true };
    for (let round = 0; round < 50; round += 1) {
      await Promise.all([settings.save(first), settings.save(second)]);
      assert.deepEqual(await settings.load(), second);
    }
  });

  it('refuses damaged settings instead of guessing', async () => {
    const settings = createSyncSettings({
      directory: dir(),
      keychain: reversing,
    });
    await settings.save(vault());
    await writeFile(
      join(dir(), 'sync.json'),
      JSON.stringify({
        deviceId: '../x',
        transport: { kind: 'folder', folder: '/s' },
      }),
    );
    await assert.rejects(settings.load(), /damaged/);
    await writeFile(
      join(dir(), 'sync.json'),
      JSON.stringify({ deviceId: 'd', transport: { kind: 'disk' } }),
    );
    await assert.rejects(settings.load(), /damaged/);
  });
});
