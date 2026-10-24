import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesOf, concatBytes } from './encoding.ts';

export const signatureLength = 64;
export const publicKeyLength = 32;

export type SigningPurpose =
  | 'nod:sig:card:v1'
  | 'nod:sig:acl:v1'
  | 'nod:sig:file:v2'
  | 'nod:sig:relay:v1'
  | 'nod:sig:join:v1'
  | 'nod:sig:invite:v1';

// One identity key signs cards, access-list records, files, relay requests
// and join proofs. Each message starts with the purpose and frames every
// field with its length, so bytes signed for one purpose can't be presented
// as another, and two fields can't be re-split into different ones.
export function framed(
  purpose: SigningPurpose,
  fields: Uint8Array[],
): Uint8Array {
  const parts = [bytesOf(purpose)];
  for (const field of fields) {
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, field.length);
    parts.push(length, field);
  }
  return concatBytes(...parts);
}

export function sign(
  signingKey: Uint8Array,
  purpose: SigningPurpose,
  fields: Uint8Array[],
): Uint8Array {
  return ed25519.sign(framed(purpose, fields), signingKey);
}

export function verify(
  publicKey: Uint8Array,
  signature: Uint8Array,
  purpose: SigningPurpose,
  fields: Uint8Array[],
): boolean {
  if (
    publicKey.length !== publicKeyLength ||
    signature.length !== signatureLength
  ) {
    return false;
  }
  // RFC 8032 rules rather than the library's ZIP-215 default, which accepts
  // small-order public keys anyone can sign for, and other spellings of one
  // point.
  try {
    return ed25519.verify(signature, framed(purpose, fields), publicKey, {
      zip215: false,
    });
  } catch {
    return false;
  }
}
