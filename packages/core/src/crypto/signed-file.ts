import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { assertKey, nonceLength, tagLength } from './aead.ts';
import { bytesOf, concatBytes, toHex } from './encoding.ts';
import type { Identity } from './identity.ts';
import { publicKeyLength, sign, signatureLength, verify } from './signing.ts';

export const signedFileVersion = 2;
export const keyIdLength = 16;
// Version, key id, identity and signature: all a place needs to read to know
// who published a file and under which key generation.
export const signedFileHeaderLength =
  1 + keyIdLength + publicKeyLength + signatureLength;

export type SignedFileHeader = {
  keyId: Uint8Array;
  identity: Uint8Array;
};

export type OpenedSignedFile = SignedFileHeader & { plain: Uint8Array };

// Version 2 binds the version byte, the context and the header, so a file
// can't be moved to another vault, device, note or key generation, or be
// re-signed by someone else and still open.
function associatedData(
  context: string,
  keyId: Uint8Array,
  identity: Uint8Array,
): Uint8Array {
  return concatBytes(
    Uint8Array.of(signedFileVersion),
    bytesOf(`${context}:${toHex(keyId)}:${toHex(identity)}`),
  );
}

export function sealSigned(
  key: Uint8Array,
  keyId: Uint8Array,
  identity: Identity,
  plain: Uint8Array,
  context: string,
): Uint8Array {
  assertKey(key);
  if (keyId.length !== keyIdLength) {
    throw new Error('A key id must be 16 bytes');
  }
  const nonce = randomBytes(nonceLength);
  const aad = associatedData(context, keyId, identity.publicKey);
  const body = gcm(key, nonce, aad).encrypt(plain);
  const version = Uint8Array.of(signedFileVersion);
  const signature = sign(identity.signingKey, 'nod:sig:file:v2', [
    version,
    keyId,
    identity.publicKey,
    nonce,
    body,
    aad,
  ]);
  return concatBytes(
    version,
    keyId,
    identity.publicKey,
    signature,
    nonce,
    body,
  );
}

// What a place or a device learns about a file before holding any key.
export function readSignedFileHeader(sealed: Uint8Array): SignedFileHeader {
  if (
    sealed[0] !== signedFileVersion ||
    sealed.length < signedFileHeaderLength + nonceLength + tagLength
  ) {
    throw new Error('Unsupported encrypted data');
  }
  return {
    keyId: sealed.subarray(1, 1 + keyIdLength),
    identity: sealed.subarray(
      1 + keyIdLength,
      1 + keyIdLength + publicKeyLength,
    ),
  };
}

// Opens the file and says who published it. Whether that identity was allowed
// to, and whether the key generation is the right one, is the caller's check.
export function openSigned(
  key: Uint8Array,
  sealed: Uint8Array,
  context: string,
): OpenedSignedFile {
  assertKey(key);
  const { keyId, identity } = readSignedFileHeader(sealed);
  const signature = sealed.subarray(
    1 + keyIdLength + publicKeyLength,
    signedFileHeaderLength,
  );
  const nonce = sealed.subarray(
    signedFileHeaderLength,
    signedFileHeaderLength + nonceLength,
  );
  const body = sealed.subarray(signedFileHeaderLength + nonceLength);
  const aad = associatedData(context, keyId, identity);
  if (
    !verify(identity, signature, 'nod:sig:file:v2', [
      Uint8Array.of(signedFileVersion),
      keyId,
      identity,
      nonce,
      body,
      aad,
    ])
  ) {
    throw new Error('Encrypted data was not signed by the identity it names');
  }
  try {
    return { keyId, identity, plain: gcm(key, nonce, aad).decrypt(body) };
  } catch {
    throw new Error('Encrypted data could not be opened with this key');
  }
}
