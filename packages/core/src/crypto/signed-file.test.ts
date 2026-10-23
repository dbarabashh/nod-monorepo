import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { open, randomKey } from './aead.ts';
import { bytesOf, textOf } from './encoding.ts';
import { identityOf } from './identity.ts';
import {
  openSigned,
  readSignedFileHeader,
  sealSigned,
  signedFileHeaderLength,
} from './signed-file.ts';

const alice = identityOf(new Uint8Array(32).fill(1));
const bob = identityOf(new Uint8Array(32).fill(2));
const key = randomKey();
const keyId = new Uint8Array(16).fill(9);
const plain = bytesOf('Shared note about the roadmap');
const context = 'nod:sync:v2:vault-a:device-1:note-1';

describe('signed files', () => {
  it('opens what it sealed and says who published it', () => {
    const sealed = sealSigned(key, keyId, alice, plain, context);
    assert.equal(sealed[0], 2);
    assert.equal(signedFileHeaderLength, 113);
    assert.equal(textOf(sealed).includes('roadmap'), false);
    const header = readSignedFileHeader(sealed);
    assert.deepEqual(header.keyId, keyId);
    assert.deepEqual(header.identity, alice.publicKey);
    const opened = openSigned(key, sealed, context);
    assert.equal(textOf(opened.plain), 'Shared note about the roadmap');
    assert.deepEqual(opened.identity, alice.publicKey);
    assert.deepEqual(opened.keyId, keyId);
  });

  it('refuses a file moved to another context, generation or publisher', () => {
    const sealed = sealSigned(key, keyId, alice, plain, context);
    assert.throws(
      () => openSigned(key, sealed, 'nod:sync:v2:vault-b:device-1:note-1'),
      /not signed/,
    );
    const otherGeneration = sealed.slice();
    otherGeneration[1] = 8;
    assert.throws(
      () => openSigned(key, otherGeneration, context),
      /not signed/,
    );
    const otherPublisher = sealed.slice();
    otherPublisher.set(bob.publicKey, 17);
    assert.throws(() => openSigned(key, otherPublisher, context), /not signed/);
    const changedText = sealed.slice();
    changedText[sealed.length - 1] = (changedText[sealed.length - 1] ?? 0) ^ 1;
    assert.throws(() => openSigned(key, changedText, context), /not signed/);
  });

  it('refuses another key, and a file version 1 or 2 opened as the other', () => {
    const sealed = sealSigned(key, keyId, alice, plain, context);
    assert.throws(
      () => openSigned(randomKey(), sealed, context),
      /could not be opened/,
    );
    assert.throws(() => open(key, sealed, context), /Unsupported/);
    assert.throws(
      () => openSigned(key, bytesOf('short'), context),
      /Unsupported/,
    );
    assert.throws(
      () => readSignedFileHeader(Uint8Array.of(1, 2, 3)),
      /Unsupported/,
    );
  });

  it('refuses a key or key id of the wrong size', () => {
    assert.throws(
      () => sealSigned(new Uint8Array(16), keyId, alice, plain, context),
      /32 bytes/,
    );
    assert.throws(
      () => sealSigned(key, new Uint8Array(8), alice, plain, context),
      /16 bytes/,
    );
  });
});
