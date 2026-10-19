import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { relayToken } from './pairing.ts';
import { fileKeyOf } from './vault-keys.ts';

describe('vault keys', () => {
  it('derives a file key that differs from the root key and the relay token', () => {
    const root = new Uint8Array(32);
    const fileKey = fileKeyOf(root);
    assert.equal(
      Buffer.from(fileKey).toString('hex'),
      '72daa657bce6f76968abf0c848ebf7de0d599c44418fc35a3d574993cfd4e3d1',
    );
    assert.notDeepEqual(fileKey, root);
    assert.notEqual(Buffer.from(fileKey).toString('hex'), relayToken(root));
  });
});
