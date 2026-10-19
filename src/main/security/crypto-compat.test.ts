import { strict as assert } from 'node:assert';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { describe, it } from 'node:test';
import {
  commitmentOf,
  createPairingKeys,
  grantKey,
  open,
  pairingCode,
  relayToken,
  seal,
  vaultIdOf,
} from '../../core/crypto/index.ts';

// The same format built on OpenSSL through node:crypto, an independent
// implementation; matching it in both directions shows the format and key
// derivations are exactly the documented ones.
function opensslSeal(key: Buffer, plain: Buffer, context: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.of(1), nonce, body, cipher.getAuthTag()]);
}

function opensslOpen(key: Buffer, sealed: Uint8Array, context: string): Buffer {
  const data = Buffer.from(sealed);
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(1, 13));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([
    decipher.update(data.subarray(13, data.length - 16)),
    decipher.final(),
  ]);
}

describe('compatibility with the OpenSSL version', () => {
  const key = randomBytes(32);
  const plain = Buffer.from('A meeting saved by the earlier version');

  it('opens files the earlier version wrote, and writes files it could open', () => {
    const old = opensslSeal(key, plain, 'nod:meeting:m1');
    assert.deepEqual(Buffer.from(open(key, old, 'nod:meeting:m1')), plain);
    const fresh = seal(key, plain, 'nod:meeting:m1');
    assert.deepEqual(opensslOpen(key, fresh, 'nod:meeting:m1'), plain);
  });

  it('agrees with OpenSSL on the pairing keys, codes and relay token', () => {
    const ours = createPairingKeys();
    const theirs = createPairingKeys();
    const opensslSecret = diffieHellman({
      privateKey: createPrivateKey({
        key: {
          kty: 'OKP',
          crv: 'X25519',
          x: ours.publicKey,
          d: ours.privateKey,
        },
        format: 'jwk',
      }),
      publicKey: createPublicKey({
        key: { kty: 'OKP', crv: 'X25519', x: theirs.publicKey },
        format: 'jwk',
      }),
    });
    assert.deepEqual(
      Buffer.from(grantKey(ours, theirs.publicKey, 'r1')),
      Buffer.from(
        hkdfSync('sha256', opensslSecret, 'nod:pairing', 'grant:r1', 32),
      ),
    );

    assert.equal(
      commitmentOf(ours.publicKey),
      createHash('sha256')
        .update(`nod:pairing:${ours.publicKey}`)
        .digest('hex'),
    );
    const [a, b] = [ours.publicKey, theirs.publicKey].sort();
    const digest = createHash('sha256')
      .update(`nod:pairing-code:${a}:${b}`)
      .digest();
    assert.equal(
      pairingCode(ours.publicKey, theirs.publicKey),
      String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0'),
    );
    assert.equal(
      relayToken(key),
      createHmac('sha256', key).update('nod:relay-token').digest('hex'),
    );
    assert.equal(
      vaultIdOf(key),
      createHash('sha256')
        .update(
          createHmac('sha256', key).update('nod:relay-token').digest('hex'),
        )
        .digest('hex')
        .slice(0, 32),
    );
  });
});
