import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { fileKeyOf, relayToken, vaultIdOf } from './vault-keys.ts';

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

describe('vault id', () => {
  it('is the same for the same key on every device, and differs between keys', () => {
    assert.equal(
      vaultIdOf(new Uint8Array(32)),
      '32e2308c839159d85348a2cdb1c021f3',
    );
    assert.notEqual(
      vaultIdOf(new Uint8Array(32).fill(1)),
      vaultIdOf(new Uint8Array(32)),
    );
  });
});
