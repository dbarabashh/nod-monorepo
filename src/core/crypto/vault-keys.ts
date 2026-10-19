import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keyLength } from './aead.ts';
import { bytesOf } from './encoding.ts';

// The recovery phrase encodes the vault's root key. Nothing uses the root key
// directly: each purpose gets its own key derived from it, so a key exposed
// in one role says nothing about another. The phrase already carries 256
// random bits, so a slow password hash would add nothing.
export function fileKeyOf(rootKey: Uint8Array): Uint8Array {
  return hkdf(
    sha256,
    rootKey,
    bytesOf('nod:vault'),
    bytesOf('files'),
    keyLength,
  );
}
