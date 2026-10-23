import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  bytesOf,
  concatBytes,
  fromBase64Url,
  toBase64Url,
  toHex,
} from './encoding.ts';
import { publicKeyLength, sign, signatureLength, verify } from './signing.ts';
import { deriveKey, groupedCode } from './vault-keys.ts';

// A person's identity is derived from the vault root key, so every device
// they pair has it without anything new to write down. Each key is derived
// on its own rather than converted from another, so no key serves two
// protocols.
export type Identity = {
  signingKey: Uint8Array;
  publicKey: Uint8Array;
  wrappingKey: Uint8Array;
  wrappingPublicKey: Uint8Array;
  blindingKey: Uint8Array;
};

export type IdentityCard = {
  publicKey: Uint8Array;
  wrappingPublicKey: Uint8Array;
};

function derive(rootKey: Uint8Array, info: string): Uint8Array {
  return deriveKey(rootKey, bytesOf(info));
}

export function identityOf(rootKey: Uint8Array): Identity {
  const signingKey = derive(rootKey, 'identity-sign');
  const wrappingKey = derive(rootKey, 'identity-wrap');
  return {
    signingKey,
    publicKey: ed25519.getPublicKey(signingKey),
    wrappingKey,
    wrappingPublicKey: x25519.getPublicKey(wrappingKey),
    blindingKey: derive(rootKey, 'device-blind'),
  };
}

const cardPrefix = 'nod-id:v1:';

// The card is public and travels over any channel; its signature shows the
// two public keys were published together by whoever holds the signing key.
export function identityCard(identity: Identity): string {
  const signature = sign(identity.signingKey, 'nod:sig:card:v1', [
    identity.publicKey,
    identity.wrappingPublicKey,
  ]);
  return `${cardPrefix}${toBase64Url(
    concatBytes(identity.publicKey, identity.wrappingPublicKey, signature),
  )}`;
}

export function parseIdentityCard(text: string): IdentityCard | null {
  if (!text.startsWith(cardPrefix)) {
    return null;
  }
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(text.slice(cardPrefix.length));
  } catch {
    return null;
  }
  if (bytes.length !== publicKeyLength * 2 + signatureLength) {
    return null;
  }
  const publicKey = bytes.subarray(0, publicKeyLength);
  const wrappingPublicKey = bytes.subarray(
    publicKeyLength,
    publicKeyLength * 2,
  );
  const signature = bytes.subarray(publicKeyLength * 2);
  return verify(publicKey, signature, 'nod:sig:card:v1', [
    publicKey,
    wrappingPublicKey,
  ])
    ? { publicKey, wrappingPublicKey }
    : null;
}

// 64 bits of the identity, grouped like the vault code.
export function identityCodeOf(publicKey: Uint8Array): string {
  return groupedCode(toHex(sha256(publicKey)));
}

export function identityHex(publicKey: Uint8Array): string {
  return toHex(publicKey);
}

const identityHexPattern = new RegExp(`^[0-9a-f]{${publicKeyLength * 2}}$`);

export function isIdentityHex(value: string): boolean {
  return identityHexPattern.test(value);
}

// A device is named differently in every shared vault, by a key only its
// owner holds, so a place that stores two vaults can't tell the devices in
// them are the same ones. The name survives key rotations, which the vault
// id doesn't follow.
export function blindedDeviceId(
  identity: Identity,
  vaultId: string,
  deviceId: string,
): string {
  return toHex(
    hmac(
      sha256,
      identity.blindingKey,
      bytesOf(`nod:device:${vaultId}:${deviceId}`),
    ),
  );
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length && i < b.length; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return a.length - b.length;
}

// Two people derive the same root key from each other's cards, so a vault
// between them exists as soon as both know each other. The curve library
// refuses a shared secret of all zeros from a crafted public key.
export function oneToOneRootKey(
  identity: Identity,
  peer: IdentityCard,
): Uint8Array {
  const order = compareBytes(identity.publicKey, peer.publicKey);
  if (order === 0) {
    throw new Error('A one-to-one vault needs two different people');
  }
  const secret = x25519.getSharedSecret(
    identity.wrappingKey,
    peer.wrappingPublicKey,
  );
  const [lower, higher] =
    order < 0
      ? [identity.publicKey, peer.publicKey]
      : [peer.publicKey, identity.publicKey];
  return deriveKey(
    secret,
    bytesOf(`one-to-one:${toBase64Url(lower)}:${toBase64Url(higher)}`),
  );
}
