import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  bytesOf,
  fileKeyOf,
  randomKey,
  seal,
  vaultIdOf,
} from '../crypto/index.ts';
import {
  checkClosedNotices,
  openClosedNotice,
  sealClosedNotice,
} from './closing.ts';
import { closedPath } from './layout.ts';
import { createMemoryTransport } from './testing/memory-transport.ts';

describe('closing a vault', () => {
  const root = randomKey();
  const fileKey = fileKeyOf(root);
  const vaultId = vaultIdOf(root);

  it('opens only for the vault and device it was written for', () => {
    const notice = sealClosedNotice(fileKey, vaultId, 'laptop', 5);
    assert.equal(openClosedNotice(fileKey, vaultId, 'laptop', notice), true);
    assert.throws(() => openClosedNotice(fileKey, vaultId, 'desktop', notice));
    assert.throws(() =>
      openClosedNotice(fileKeyOf(randomKey()), vaultId, 'laptop', notice),
    );
    assert.throws(() =>
      openClosedNotice(fileKey, vaultIdOf(randomKey()), 'laptop', notice),
    );
  });

  it('reads a notice without a closing time as no notice', () => {
    const notice = seal(fileKey, bytesOf('{}'), `nod:closed:${vaultId}:laptop`);
    assert.equal(openClosedNotice(fileKey, vaultId, 'laptop', notice), false);
  });
});

describe('checking for closed notices', () => {
  const root = randomKey();
  const vault = {
    fileKey: fileKeyOf(root),
    id: vaultIdOf(root),
    deviceId: 'phone',
  };

  it('finds a notice another device left, and ignores its own', async () => {
    const transport = createMemoryTransport();
    await transport.write(
      closedPath('phone'),
      sealClosedNotice(vault.fileKey, vault.id, 'phone', 1),
    );
    assert.deepEqual(await checkClosedNotices(transport, vault, new Map()), {
      closed: false,
      readable: true,
    });

    await transport.write(
      closedPath('laptop'),
      sealClosedNotice(vault.fileKey, vault.id, 'laptop', 2),
    );
    assert.deepEqual(await checkClosedNotices(transport, vault, new Map()), {
      closed: true,
      readable: true,
    });
  });

  it('reads past a forged notice once, and holds back on one it can’t fetch', async () => {
    const transport = createMemoryTransport();
    await transport.write(closedPath('laptop'), bytesOf('forged'));
    const checked = new Map<string, string>();
    assert.deepEqual(await checkClosedNotices(transport, vault, checked), {
      closed: false,
      readable: true,
    });
    assert.equal(checked.size, 1);

    const failing = {
      ...transport,
      read: async () => {
        throw new Error('offline');
      },
    };
    await transport.write(closedPath('tablet'), bytesOf('x'));
    assert.deepEqual(await checkClosedNotices(failing, vault, checked), {
      closed: false,
      readable: false,
    });
  });
});
