import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { randomKey } from './aead.ts';
import { identityOf } from './identity.ts';
import { unwrapKey, wrapKey } from './wrap.ts';

const alice = identityOf(new Uint8Array(32).fill(1));
const bob = identityOf(new Uint8Array(32).fill(2));
const context = 'nod:wrap:vault-a:requestAccept:gen-1:recipient';

describe('key wrap', () => {
  it('hands a key to one person, who gets it back exactly', () => {
    const key = randomKey();
    const wrapped = wrapKey(bob.wrappingPublicKey, key, context);
    assert.deepEqual(unwrapKey(bob.wrappingKey, wrapped, context), key);
    assert.equal(wrapped.length, 32 + 32 + 16);
    assert.equal(Buffer.from(wrapped).includes(Buffer.from(key)), false);
  });

  it('uses a fresh ephemeral key every time', () => {
    const key = randomKey();
    assert.notDeepEqual(
      wrapKey(bob.wrappingPublicKey, key, context),
      wrapKey(bob.wrappingPublicKey, key, context),
    );
  });

  it('opens for nobody else, in no other context, and not when changed', () => {
    const key = randomKey();
    const wrapped = wrapKey(bob.wrappingPublicKey, key, context);
    assert.throws(
      () => unwrapKey(alice.wrappingKey, wrapped, context),
      /could not be opened/,
    );
    assert.throws(
      () => unwrapKey(bob.wrappingKey, wrapped, `${context}-other`),
      /could not be opened/,
    );
    const flipped = wrapped.slice();
    flipped[40] = (flipped[40] ?? 0) ^ 1;
    assert.throws(() => unwrapKey(bob.wrappingKey, flipped, context));
    assert.throws(() =>
      unwrapKey(bob.wrappingKey, wrapped.subarray(0, 40), context),
    );
  });
});
