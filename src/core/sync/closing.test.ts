import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  bytesOf,
  fileKeyOf,
  randomKey,
  seal,
  vaultIdOf,
} from '../crypto/index.ts';
import { openClosedNotice, sealClosedNotice } from './closing.ts';

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
