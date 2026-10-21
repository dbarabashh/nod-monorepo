import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keyLength } from './aead.ts';
import { bytesOf, toHex } from './encoding.ts';

// The pairing secret travels only in the QR code. Each use gets its own key
// from it, like the vault's subkeys: the proof a phone sends to ask for the
// offer says nothing about the key that seals the offer.
export function pairingProof(secret: Uint8Array): string {
  return toHex(hmac(sha256, secret, bytesOf('nod:pair-request')));
}

export function pairingOfferKey(secret: Uint8Array): Uint8Array {
  return hkdf(sha256, secret, bytesOf('nod:pair'), bytesOf('offer'), keyLength);
}
