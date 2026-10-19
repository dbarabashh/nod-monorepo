import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keyLength } from './aead.ts';
import { bytesOf, toHex } from './encoding.ts';

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

export function relayToken(vaultKey: Uint8Array): string {
  return toHex(hmac(sha256, vaultKey, bytesOf('nod:relay-token')));
}

// The vault is named after its key, so the 24 words alone find it again on a
// new device. It is a hash of the relay token, so a relay can check that
// whoever registers a vault holds its key, and nobody can claim it first.
export function vaultIdOf(vaultKey: Uint8Array): string {
  return toHex(sha256(bytesOf(relayToken(vaultKey))).subarray(0, 16));
}
