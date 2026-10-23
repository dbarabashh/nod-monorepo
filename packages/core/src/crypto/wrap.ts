import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { nonceLength, tagLength } from './aead.ts';
import { bytesOf, concatBytes } from './encoding.ts';
import { deriveKey } from './vault-keys.ts';

const ephemeralLength = 32;
// The wrapping key is used for one message only, so a fixed nonce is safe
// and spares the bytes.
const nonce = new Uint8Array(nonceLength);

function wrappingKeyFor(
  secret: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  recipientPublicKey: Uint8Array,
): Uint8Array {
  return deriveKey(
    secret,
    concatBytes(bytesOf('wrap'), ephemeralPublicKey, recipientPublicKey),
  );
}

// A key handed to one person: sealed under a key only they and a fresh
// ephemeral key can derive, with the context (which vault, record,
// generation and recipient) bound in, so a wrap can't be replayed anywhere
// else. The ephemeral public key travels in front of the ciphertext.
export function wrapKey(
  recipientPublicKey: Uint8Array,
  key: Uint8Array,
  context: string,
): Uint8Array {
  const ephemeralKey = randomBytes(ephemeralLength);
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralKey);
  const secret = x25519.getSharedSecret(ephemeralKey, recipientPublicKey);
  const body = gcm(
    wrappingKeyFor(secret, ephemeralPublicKey, recipientPublicKey),
    nonce,
    bytesOf(context),
  ).encrypt(key);
  return concatBytes(ephemeralPublicKey, body);
}

export function unwrapKey(
  wrappingKey: Uint8Array,
  wrapped: Uint8Array,
  context: string,
): Uint8Array {
  if (wrapped.length < ephemeralLength + tagLength) {
    throw new Error('Wrapped key could not be opened');
  }
  const ephemeralPublicKey = wrapped.subarray(0, ephemeralLength);
  try {
    const secret = x25519.getSharedSecret(wrappingKey, ephemeralPublicKey);
    return gcm(
      wrappingKeyFor(
        secret,
        ephemeralPublicKey,
        x25519.getPublicKey(wrappingKey),
      ),
      nonce,
      bytesOf(context),
    ).decrypt(wrapped.subarray(ephemeralLength));
  } catch {
    throw new Error('Wrapped key could not be opened');
  }
}
