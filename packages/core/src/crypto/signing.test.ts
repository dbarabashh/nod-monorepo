import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { bytesOf } from './encoding.ts';
import { identityOf } from './identity.ts';
import { framed, sign, verify } from './signing.ts';

const alice = identityOf(new Uint8Array(32).fill(1));
const bob = identityOf(new Uint8Array(32).fill(2));

describe('signing', () => {
  it('frames each field with its length behind the purpose', () => {
    assert.deepEqual(
      framed('nod:sig:card:v1', [bytesOf('ab'), bytesOf('')]),
      Uint8Array.from([
        ...bytesOf('nod:sig:card:v1'),
        0,
        0,
        0,
        2,
        ...bytesOf('ab'),
        0,
        0,
        0,
        0,
      ]),
    );
  });

  it('verifies only the same fields, split the same way, for the same purpose', () => {
    const fields = [bytesOf('abc'), bytesOf('def')];
    const signature = sign(alice.signingKey, 'nod:sig:acl:v1', fields);
    assert.equal(signature.length, 64);
    assert.equal(
      verify(alice.publicKey, signature, 'nod:sig:acl:v1', fields),
      true,
    );
    assert.equal(
      verify(bob.publicKey, signature, 'nod:sig:acl:v1', fields),
      false,
    );
    assert.equal(
      verify(alice.publicKey, signature, 'nod:sig:relay:v1', fields),
      false,
    );
    assert.equal(
      verify(alice.publicKey, signature, 'nod:sig:acl:v1', [
        bytesOf('ab'),
        bytesOf('cdef'),
      ]),
      false,
    );
    assert.equal(
      verify(alice.publicKey, signature, 'nod:sig:acl:v1', [bytesOf('abcdef')]),
      false,
    );
    assert.equal(
      verify(alice.publicKey, signature.subarray(1), 'nod:sig:acl:v1', fields),
      false,
    );
    assert.equal(
      verify(new Uint8Array(31), signature, 'nod:sig:acl:v1', fields),
      false,
    );
  });
});

describe('signing with a small-order key', () => {
  it('accepts no signature for a key anyone can sign for', () => {
    // The identity point encoded as a public key: every scalar times it is
    // the identity, so under the lenient rules any signature R = identity,
    // S = 0 verifies for any message.
    const smallOrder = new Uint8Array(32);
    smallOrder[0] = 1;
    const signature = new Uint8Array(64);
    signature[0] = 1;
    assert.equal(
      verify(smallOrder, signature, 'nod:sig:acl:v1', [bytesOf('anything')]),
      false,
    );
  });
});
