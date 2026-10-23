import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  blindedDeviceId,
  identityCard,
  identityCodeOf,
  identityOf,
  oneToOneRootKey,
  parseIdentityCard,
} from './identity.ts';
import { fileKeyOf } from './vault-keys.ts';

const alice = identityOf(new Uint8Array(32).fill(1));
const bob = identityOf(new Uint8Array(32).fill(2));

describe('identity', () => {
  it('is the same on every device with the root key, and differs between keys', () => {
    const again = identityOf(new Uint8Array(32).fill(1));
    assert.deepEqual(again.publicKey, alice.publicKey);
    assert.deepEqual(again.wrappingPublicKey, alice.wrappingPublicKey);
    assert.notDeepEqual(bob.publicKey, alice.publicKey);
    assert.equal(alice.publicKey.length, 32);
    assert.equal(alice.wrappingPublicKey.length, 32);
  });

  it('derives keys that share nothing with each other or the file key', () => {
    const root = new Uint8Array(32).fill(1);
    const keys = [
      alice.signingKey,
      alice.wrappingKey,
      alice.blindingKey,
      fileKeyOf(root),
      root,
    ].map((key) => Buffer.from(key).toString('hex'));
    assert.equal(new Set(keys).size, keys.length);
  });

  it('shows a code of four groups that two people can compare aloud', () => {
    const code = identityCodeOf(alice.publicKey);
    assert.match(code, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    assert.notEqual(code, identityCodeOf(bob.publicKey));
  });
});

describe('identity card', () => {
  it('carries both public keys and reads back on another device', () => {
    const card = identityCard(alice);
    assert.match(card, /^nod-id:v1:[A-Za-z0-9_-]+$/);
    const parsed = parseIdentityCard(card);
    assert.ok(parsed);
    assert.deepEqual(parsed.publicKey, alice.publicKey);
    assert.deepEqual(parsed.wrappingPublicKey, alice.wrappingPublicKey);
  });

  it('refuses a card whose keys were swapped, cut or signed by someone else', () => {
    const card = identityCard(alice);
    const prefix = 'nod-id:v1:';
    const bytes = Buffer.from(card.slice(prefix.length), 'base64url');
    const swapped = Buffer.concat([
      bytes.subarray(32, 64),
      bytes.subarray(0, 32),
      bytes.subarray(64),
    ]);
    assert.equal(
      parseIdentityCard(`${prefix}${swapped.toString('base64url')}`),
      null,
    );
    const otherWrap = Buffer.concat([
      bytes.subarray(0, 32),
      Buffer.from(bob.wrappingPublicKey),
      bytes.subarray(64),
    ]);
    assert.equal(
      parseIdentityCard(`${prefix}${otherWrap.toString('base64url')}`),
      null,
    );
    assert.equal(
      parseIdentityCard(
        `${prefix}${bytes.subarray(0, 100).toString('base64url')}`,
      ),
      null,
    );
    assert.equal(
      parseIdentityCard(`nod-id:v2:${card.slice(prefix.length)}`),
      null,
    );
    assert.equal(parseIdentityCard('nod-id:v1:not base64!'), null);
  });
});

describe('blinded device id', () => {
  it('names a device differently in every vault, the same across rotations', () => {
    const inTeam = blindedDeviceId(alice, 'vault-a', 'device-1');
    assert.match(inTeam, /^[0-9a-f]{64}$/);
    assert.equal(blindedDeviceId(alice, 'vault-a', 'device-1'), inTeam);
    assert.notEqual(blindedDeviceId(alice, 'vault-b', 'device-1'), inTeam);
    assert.notEqual(blindedDeviceId(alice, 'vault-a', 'device-2'), inTeam);
    assert.notEqual(blindedDeviceId(bob, 'vault-a', 'device-1'), inTeam);
  });
});

describe('one-to-one root key', () => {
  it('comes out the same on both sides and differs between pairs', () => {
    const carol = identityOf(new Uint8Array(32).fill(3));
    const cardOf = (identity: typeof alice) => {
      const card = parseIdentityCard(identityCard(identity));
      assert.ok(card);
      return card;
    };
    const fromAlice = oneToOneRootKey(alice, cardOf(bob));
    const fromBob = oneToOneRootKey(bob, cardOf(alice));
    assert.deepEqual(fromBob, fromAlice);
    assert.equal(fromAlice.length, 32);
    assert.notDeepEqual(oneToOneRootKey(alice, cardOf(carol)), fromAlice);
    assert.notDeepEqual(fromAlice, alice.wrappingKey);
  });

  it("refuses a card naming the device's own identity or a crafted public key", () => {
    const own = parseIdentityCard(identityCard(alice));
    assert.ok(own);
    assert.throws(() => oneToOneRootKey(alice, own), /two different people/);
    assert.throws(
      () =>
        oneToOneRootKey(alice, {
          publicKey: bob.publicKey,
          wrappingPublicKey: new Uint8Array(32),
        }),
      /invalid private or public key/,
    );
  });
});
