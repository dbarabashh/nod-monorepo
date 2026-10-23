import { strict as assert } from 'node:assert';
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  randomBytes,
  sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto';
import { describe, it } from 'node:test';
import {
  identityCard,
  identityOf,
  oneToOneRootKey,
  openSigned,
  parseIdentityCard,
  sealSigned,
  unwrapKey,
  wrapKey,
} from '@nod/core/crypto';

// The identity, the signed file and the key wrap built on OpenSSL through
// node:crypto, an independent implementation; matching it in both directions
// shows the derivations and formats are exactly the documented ones.
const ed25519Pkcs8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const x25519Pkcs8 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const x25519Spki = Buffer.from('302a300506032b656e032100', 'hex');

function derived(root: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', root, 'nod:vault', info, 32));
}

function ed25519Key(seed: Buffer) {
  return createPrivateKey({
    key: Buffer.concat([ed25519Pkcs8, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

function x25519Key(seed: Buffer) {
  return createPrivateKey({
    key: Buffer.concat([x25519Pkcs8, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

function x25519Public(raw: Uint8Array) {
  return createPublicKey({
    key: Buffer.concat([x25519Spki, Buffer.from(raw)]),
    format: 'der',
    type: 'spki',
  });
}

function rawPublic(key: ReturnType<typeof createPrivateKey>): Buffer {
  const jwk = createPublicKey(key).export({ format: 'jwk' });
  return Buffer.from(jwk.x ?? '', 'base64url');
}

function framed(purpose: string, fields: Uint8Array[]): Buffer {
  const parts = [Buffer.from(purpose)];
  for (const field of fields) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(field.length);
    parts.push(length, Buffer.from(field));
  }
  return Buffer.concat(parts);
}

const rootA = randomBytes(32);
const rootB = randomBytes(32);
const alice = identityOf(rootA);
const bob = identityOf(rootB);

describe('identity against OpenSSL', () => {
  it('derives the same public keys from the root key', () => {
    assert.deepEqual(
      Buffer.from(alice.publicKey),
      rawPublic(ed25519Key(derived(rootA, 'identity-sign'))),
    );
    assert.deepEqual(
      Buffer.from(alice.wrappingPublicKey),
      rawPublic(x25519Key(derived(rootA, 'identity-wrap'))),
    );
  });

  it('signs the card so that OpenSSL verifies it under the card purpose', () => {
    const card = identityCard(alice);
    const bytes = Buffer.from(card.slice('nod-id:v1:'.length), 'base64url');
    assert.equal(
      nodeVerify(
        null,
        framed('nod:sig:card:v1', [alice.publicKey, alice.wrappingPublicKey]),
        createPublicKey(ed25519Key(derived(rootA, 'identity-sign'))),
        bytes.subarray(64),
      ),
      true,
    );
  });

  it('derives the one-to-one root key from the same Diffie-Hellman exchange', () => {
    const peer = parseIdentityCard(identityCard(bob));
    assert.ok(peer);
    const secret = diffieHellman({
      privateKey: x25519Key(derived(rootA, 'identity-wrap')),
      publicKey: x25519Public(bob.wrappingPublicKey),
    });
    const [lower, higher] = [alice.publicKey, bob.publicKey].sort(
      Buffer.compare,
    );
    assert.deepEqual(
      Buffer.from(oneToOneRootKey(alice, peer)),
      Buffer.from(
        hkdfSync(
          'sha256',
          secret,
          'nod:vault',
          `one-to-one:${Buffer.from(lower ?? []).toString('base64url')}:${Buffer.from(higher ?? []).toString('base64url')}`,
          32,
        ),
      ),
    );
  });
});

describe('signed files against OpenSSL', () => {
  const key = randomBytes(32);
  const keyId = randomBytes(16);
  const context = 'nod:sync:v2:vault:device:note';
  const plain = Buffer.from('A note the other side can read');

  it('opens a file OpenSSL sealed and signed', () => {
    const nonce = randomBytes(12);
    const aad = Buffer.concat([
      Buffer.of(2),
      Buffer.from(
        `${context}:${keyId.toString('hex')}:${Buffer.from(alice.publicKey).toString('hex')}`,
      ),
    ]);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad);
    const body = Buffer.concat([
      cipher.update(plain),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const signature = nodeSign(
      null,
      framed('nod:sig:file:v2', [
        Buffer.of(2),
        keyId,
        alice.publicKey,
        nonce,
        body,
        aad,
      ]),
      ed25519Key(derived(rootA, 'identity-sign')),
    );
    const sealed = Buffer.concat([
      Buffer.of(2),
      keyId,
      Buffer.from(alice.publicKey),
      signature,
      nonce,
      body,
    ]);
    const opened = openSigned(key, sealed, context);
    assert.deepEqual(Buffer.from(opened.plain), plain);
    assert.deepEqual(
      Buffer.from(opened.identity),
      Buffer.from(alice.publicKey),
    );
  });

  it('writes a file OpenSSL verifies and decrypts', () => {
    const sealed = Buffer.from(sealSigned(key, keyId, alice, plain, context));
    const nonce = sealed.subarray(113, 125);
    const body = sealed.subarray(125);
    const aad = Buffer.concat([
      Buffer.of(2),
      Buffer.from(
        `${context}:${keyId.toString('hex')}:${Buffer.from(alice.publicKey).toString('hex')}`,
      ),
    ]);
    assert.equal(
      nodeVerify(
        null,
        framed('nod:sig:file:v2', [
          Buffer.of(2),
          keyId,
          alice.publicKey,
          nonce,
          body,
          aad,
        ]),
        createPublicKey(ed25519Key(derived(rootA, 'identity-sign'))),
        sealed.subarray(49, 113),
      ),
      true,
    );
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(body.subarray(body.length - 16));
    assert.deepEqual(
      Buffer.concat([
        decipher.update(body.subarray(0, body.length - 16)),
        decipher.final(),
      ]),
      plain,
    );
  });
});

describe('key wrap against OpenSSL', () => {
  it('wraps a key OpenSSL unwraps, and unwraps one OpenSSL wrapped', () => {
    const key = randomBytes(32);
    const context = 'nod:wrap:vault:requestAccept:gen:recipient';
    const bobWrapping = x25519Key(derived(rootB, 'identity-wrap'));
    const unwrapWithNode = (wrapped: Uint8Array) => {
      const ephemeral = Buffer.from(wrapped.subarray(0, 32));
      const secret = diffieHellman({
        privateKey: bobWrapping,
        publicKey: x25519Public(ephemeral),
      });
      const wrappingKey = Buffer.from(
        hkdfSync(
          'sha256',
          secret,
          'nod:vault',
          Buffer.concat([
            Buffer.from('wrap'),
            ephemeral,
            Buffer.from(bob.wrappingPublicKey),
          ]),
          32,
        ),
      );
      const decipher = createDecipheriv(
        'aes-256-gcm',
        wrappingKey,
        Buffer.alloc(12),
      );
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(Buffer.from(wrapped.subarray(wrapped.length - 16)));
      return Buffer.concat([
        decipher.update(Buffer.from(wrapped.subarray(32, wrapped.length - 16))),
        decipher.final(),
      ]);
    };
    assert.deepEqual(
      unwrapWithNode(wrapKey(bob.wrappingPublicKey, key, context)),
      key,
    );

    const ephemeralKey = x25519Key(randomBytes(32));
    const ephemeralPublic = rawPublic(ephemeralKey);
    const secret = diffieHellman({
      privateKey: ephemeralKey,
      publicKey: x25519Public(bob.wrappingPublicKey),
    });
    const wrappingKey = Buffer.from(
      hkdfSync(
        'sha256',
        secret,
        'nod:vault',
        Buffer.concat([
          Buffer.from('wrap'),
          ephemeralPublic,
          Buffer.from(bob.wrappingPublicKey),
        ]),
        32,
      ),
    );
    const cipher = createCipheriv('aes-256-gcm', wrappingKey, Buffer.alloc(12));
    cipher.setAAD(Buffer.from(context));
    const wrapped = Buffer.concat([
      ephemeralPublic,
      cipher.update(key),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    assert.deepEqual(
      Buffer.from(unwrapKey(bob.wrappingKey, wrapped, context)),
      key,
    );
  });
});
