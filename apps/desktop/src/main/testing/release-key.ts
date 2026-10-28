import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

export type ReleaseKey = {
  publicKey: string;
  sign: (bytes: Uint8Array) => string;
  privateKey: KeyObject;
};

export function releaseKey(): ReleaseKey {
  const pair = generateKeyPairSync('ed25519');
  const spki = pair.publicKey.export({ format: 'der', type: 'spki' });
  return {
    publicKey: spki.subarray(12).toString('base64'),
    sign: (bytes) => sign(null, bytes, pair.privateKey).toString('base64'),
    privateKey: pair.privateKey,
  };
}
