import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { bytesOf, concatBytes } from './encoding.ts';

const version = 1;
const supportedVersions = new Set([version]);
export const nonceLength = 12;
export const tagLength = 16;

export const keyLength = 32;

export function randomKey(): Uint8Array {
  return randomBytes(keyLength);
}

// AES-GCM also takes shorter keys; anything but a 256-bit key is a mistake
// here, so it is refused rather than quietly used as AES-128.
export function assertKey(key: Uint8Array) {
  if (key.length !== keyLength) {
    throw new Error('An encryption key must be 32 bytes');
  }
}

// Version 1 binds only the context, as every file already sealed does. Any
// later version binds its version byte too, so a file can never be opened as
// a version it wasn't sealed with; contexts start with ASCII, so a version
// byte in front can't read as one.
function associatedData(of: number, context: string): Uint8Array {
  return of === 1
    ? bytesOf(context)
    : concatBytes(Uint8Array.of(of), bytesOf(context));
}

export function seal(
  key: Uint8Array,
  plain: Uint8Array,
  context: string,
): Uint8Array {
  assertKey(key);
  const nonce = randomBytes(nonceLength);
  const body = gcm(key, nonce, associatedData(version, context)).encrypt(plain);
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
  const sealedVersion = sealed[0] ?? 0;
  if (
    sealed.length < 1 + nonceLength + tagLength ||
    !supportedVersions.has(sealedVersion)
  ) {
    throw new Error('Unsupported encrypted data');
  }
  const nonce = sealed.subarray(1, 1 + nonceLength);
  try {
    return gcm(key, nonce, associatedData(sealedVersion, context)).decrypt(
      sealed.subarray(1 + nonceLength),
    );
  } catch {
    throw new Error('Encrypted data could not be opened with this key');
  }
}
