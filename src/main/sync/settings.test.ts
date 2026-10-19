import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { KeyWrap } from '../security/data-key.ts';
import { useTempDir } from '../testing/temp-dir.ts';
import { createSyncSettings, type Vault } from './settings.ts';

const reversing: KeyWrap = {
  wrap: (plain) => Buffer.from(plain).reverse(),
  unwrap: (data) => Buffer.from(data).reverse().toString(),
};

describe('sync settings', () => {
  const dir = useTempDir('sync-settings-');
  const vault = (): Vault => ({
    id: 'vault-1',
    key: randomBytes(32),
    deviceId: 'device-1',
    transport: { kind: 'folder', folder: '/sync' },
    recoveryConfirmed: false,
  });

  it('remembers the vault, keeping its key out of the settings file', async () => {
    const settings = createSyncSettings({
      directory: dir(),
      keychain: reversing,
    });
    const saved = vault();
    await settings.save(saved);
    assert.deepEqual(await settings.load(), saved);
    const plain = await readFile(join(dir(), 'sync.json'), 'utf8');
    assert.equal(
      plain.includes(Buffer.from(saved.key).toString('base64')),
      false,
    );
  });

  it('is off until a vault is saved, and off again once cleared', async () => {
    const settings = createSyncSettings({
      directory: dir(),
      keychain: reversing,
    });
    assert.equal(await settings.load(), null);
    await settings.save(vault());
    await settings.clear();
    assert.equal(await settings.load(), null);
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
        vaultId: '../x',
        deviceId: 'd',
        transport: { kind: 'folder', folder: '/s' },
      }),
    );
    await assert.rejects(settings.load(), /damaged/);
  });
});
