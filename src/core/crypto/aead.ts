import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { bytesOf, concatBytes } from './encoding.ts';

const version = 1;
const nonceLength = 12;
const tagLength = 16;

export const keyLength = 32;

export function randomKey(): Uint8Array {
  return randomBytes(keyLength);
}

// AES-GCM also takes shorter keys; anything but a 256-bit key is a mistake
// here, so it is refused rather than quietly used as AES-128.
function assertKey(key: Uint8Array) {
  if (key.length !== keyLength) {
    throw new Error('An encryption key must be 32 bytes');
  }
}

export function seal(
  key: Uint8Array,
  plain: Uint8Array,
  context: string,
): Uint8Array {
  assertKey(key);
  const nonce = randomBytes(nonceLength);
  const body = gcm(key, nonce, bytesOf(context)).encrypt(plain);
  return concatBytes(Uint8Array.of(version), nonce, body);
}

// The context is bound into the tag, so a file moved to another meeting,
// device or vault fails to open instead of being read as that one.
export function open(
  key: Uint8Array,
  sealed: Uint8Array,
  context: string,
): Uint8Array {
  assertKey(key);
  if (sealed.length < 1 + nonceLength + tagLength || sealed[0] !== version) {
    throw new Error('Unsupported encrypted data');
  }
  const nonce = sealed.subarray(1, 1 + nonceLength);
  try {
    return gcm(key, nonce, bytesOf(context)).decrypt(
      sealed.subarray(1 + nonceLength),
    );
  } catch {
    throw new Error('Encrypted data could not be opened with this key');
  }
}
