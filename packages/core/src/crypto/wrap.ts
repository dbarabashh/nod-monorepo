import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { keyLength, nonceLength, tagLength } from './aead.ts';
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

// Something handed to one person: sealed under a key only they and a fresh
// ephemeral key can derive, with the context (which vault, record,
// generation and recipient) bound in, so it can't be replayed anywhere else.
// The ephemeral public key travels in front of the ciphertext. Keys are
// wrapped this way, and so is the name a joiner sends their inviter.
export function sealFor(
  recipientPublicKey: Uint8Array,
  plain: Uint8Array,
  context: string,
): Uint8Array {
  const ephemeralKey = randomBytes(ephemeralLength);
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralKey);
  const secret = x25519.getSharedSecret(ephemeralKey, recipientPublicKey);
  const body = gcm(
    wrappingKeyFor(secret, ephemeralPublicKey, recipientPublicKey),
    nonce,
    bytesOf(context),
  ).encrypt(plain);
  return concatBytes(ephemeralPublicKey, body);
}

export function openFor(
  wrappingKey: Uint8Array,
  sealed: Uint8Array,
  context: string,
): Uint8Array {
  if (sealed.length < ephemeralLength + tagLength) {
    throw new Error('Wrapped key could not be opened');
  }
  const ephemeralPublicKey = sealed.subarray(0, ephemeralLength);
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
    ).decrypt(sealed.subarray(ephemeralLength));
  } catch {
    throw new Error('Wrapped key could not be opened');
  }
}

export function wrapKey(
  recipientPublicKey: Uint8Array,
  key: Uint8Array,
  context: string,
): Uint8Array {
  return sealFor(recipientPublicKey, key, context);
}

export function unwrapKey(
  wrappingKey: Uint8Array,
  wrapped: Uint8Array,
  context: string,
): Uint8Array {
  const key = openFor(wrappingKey, wrapped, context);
  if (key.length !== keyLength) {
    throw new Error('Wrapped key could not be opened');
  }
  return key;
}
