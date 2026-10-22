import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { keyLength, open, randomKey, seal } from './aead.ts';
import { bytesOf, textOf } from './encoding.ts';

describe('seal and open', () => {
  const key = randomKey();
  const plain = bytesOf('Salary talk with Ann');

  it('opens what it sealed, and never stores the text in the clear', () => {
    const sealed = seal(key, plain, 'meeting:m1');
    assert.equal(textOf(sealed).includes('Salary'), false);
    assert.equal(
      textOf(open(key, sealed, 'meeting:m1')),
      'Salary talk with Ann',
    );
    assert.equal(key.length, keyLength);
  });

  it('refuses a file moved to another context, a changed byte or another key', () => {
    const sealed = seal(key, plain, 'meeting:m1');
    assert.throws(() => open(key, sealed, 'meeting:m2'), /could not be opened/);
    const flipped = sealed.slice();
    flipped[20] = (flipped[20] ?? 0) ^ 1;
    assert.throws(() => open(key, flipped, 'meeting:m1'));
    assert.throws(() => open(randomKey(), sealed, 'meeting:m1'));
    const relabeled = sealed.slice();
    relabeled[0] = 2;
    assert.throws(() => open(key, relabeled, 'meeting:m1'), /Unsupported/);
    assert.throws(
      () => open(key, bytesOf('short'), 'meeting:m1'),
      /Unsupported/,
    );
  });

  it('opens a file sealed by OpenSSL for the same key, nonce and context', () => {
    const fromHex = (hex: string) =>
      Uint8Array.from(hex.match(/../g) ?? [], (byte) =>
        Number.parseInt(byte, 16),
      );
    const sealedByOpenssl = fromHex(
      '01090909090909090909090909' +
        '4cebebe3d0d0a00fd315ae4a' +
        'c6cb5d4cee390c3fa65cce670fc1567e',
    );
    assert.equal(
      textOf(
        open(new Uint8Array(32).fill(7), sealedByOpenssl, 'nod:meeting:kat'),
      ),
      'known answer',
    );
  });

  it('refuses a key that is not 256 bits', () => {
    assert.throws(() => seal(new Uint8Array(16), plain, 'x'), /32 bytes/);
    assert.throws(
      () => open(new Uint8Array(16), seal(key, plain, 'x'), 'x'),
      /32 bytes/,
    );
  });
});
