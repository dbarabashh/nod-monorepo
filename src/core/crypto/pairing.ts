import { equalBytes } from '@noble/ciphers/utils.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keyLength } from './aead.ts';
import { bytesOf, fromBase64Url, toBase64Url, toHex } from './encoding.ts';

// Keys travel as base64url of the raw 32 bytes, the same text a JWK carries.
export type PairingKeys = {
  publicKey: string;
  privateKey: string;
};

export function createPairingKeys(): PairingKeys {
  const { secretKey, publicKey } = x25519.keygen();
  return {
    publicKey: toBase64Url(publicKey),
    privateKey: toBase64Url(secretKey),
  };
}

export function commitmentOf(publicKey: string): string {
  return toHex(sha256(bytesOf(`nod:pairing:${publicKey}`)));
}

export function matchesCommitment(
  publicKey: string,
  commitment: string,
): boolean {
  return equalBytes(bytesOf(commitmentOf(publicKey)), bytesOf(commitment));
}

// Both devices compute the same code from the same two keys; a key swapped
// in transit changes it on one side.
export function pairingCode(first: string, second: string): string {
  const [a, b] = [first, second].sort();
  const digest = sha256(bytesOf(`nod:pairing-code:${a}:${b}`));
  const value = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0);
  return String(value % 1_000_000).padStart(6, '0');
}

export function grantKey(
  keys: PairingKeys,
  peerPublicKey: string,
  requestId: string,
): Uint8Array {
  const secret = x25519.getSharedSecret(
    fromBase64Url(keys.privateKey),
    fromBase64Url(peerPublicKey),
  );
  return hkdf(
    sha256,
    secret,
    bytesOf('nod:pairing'),
    bytesOf(`grant:${requestId}`),
    keyLength,
  );
}

export function relayToken(vaultKey: Uint8Array): string {
  return toHex(hmac(sha256, vaultKey, bytesOf('nod:relay-token')));
}
