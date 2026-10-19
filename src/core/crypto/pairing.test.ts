import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  commitmentOf,
  createPairingKeys,
  grantKey,
  matchesCommitment,
  pairingCode,
  vaultIdOf,
} from './pairing.ts';

describe('pairing crypto', () => {
  it('gives both devices the same grant key and the same code', () => {
    const joining = createPairingKeys();
    const approving = createPairingKeys();
    assert.deepEqual(
      grantKey(joining, approving.publicKey, 'r1'),
      grantKey(approving, joining.publicKey, 'r1'),
    );
    assert.equal(
      pairingCode(joining.publicKey, approving.publicKey),
      pairingCode(approving.publicKey, joining.publicKey),
    );
    assert.match(
      pairingCode(joining.publicKey, approving.publicKey),
      /^\d{6}$/,
    );
  });

  it('shows a different code and key when a key was swapped in transit', () => {
    const joining = createPairingKeys();
    const approving = createPairingKeys();
    const attacker = createPairingKeys();
    assert.notEqual(
      pairingCode(joining.publicKey, attacker.publicKey),
      pairingCode(attacker.publicKey, approving.publicKey),
    );
    assert.notDeepEqual(
      grantKey(attacker, approving.publicKey, 'r1'),
      grantKey(joining, approving.publicKey, 'r1'),
    );
  });

  it('accepts only the key that was committed to', () => {
    const joining = createPairingKeys();
    const commitment = commitmentOf(joining.publicKey);
    assert.equal(matchesCommitment(joining.publicKey, commitment), true);
    assert.equal(
      matchesCommitment(createPairingKeys().publicKey, commitment),
      false,
    );
    assert.equal(matchesCommitment(joining.publicKey, 'short'), false);
  });

  it('derives a different grant key for another request', () => {
    const joining = createPairingKeys();
    const approving = createPairingKeys();
    assert.notDeepEqual(
      grantKey(joining, approving.publicKey, 'r1'),
      grantKey(joining, approving.publicKey, 'r2'),
    );
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
