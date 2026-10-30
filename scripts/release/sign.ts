import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const ed25519SpkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
const publicKey = /^[A-Za-z0-9+/]{43}=$/;

export function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

// One raw Ed25519 public key in base64, or the current and next key
// separated by a comma, as NOD_UPDATE_PUBLIC_KEY holds them.
function trusted(keys: string): string[] | null {
  const list = keys.split(',').map((key) => key.trim());
  return list.length <= 2 && list.every((key) => publicKey.test(key))
    ? list
    : null;
}

export function verifyManifest(
  bytes: Uint8Array,
  signature: string,
  keys: string,
): boolean {
  const decoded = Buffer.from(signature.trim(), 'base64');
  return (trusted(keys) ?? []).some((key) => {
    try {
      return verify(
        null,
        bytes,
        createPublicKey({
          key: Buffer.concat([ed25519SpkiPrefix, Buffer.from(key, 'base64')]),
          format: 'der',
          type: 'spki',
        }),
        decoded,
      );
    } catch {
      return false;
    }
  });
}

// The release key comes from the environment of the one job that signs, as
// a PKCS #8 PEM; the public keys are checked too, so a key that installed
// copies would reject never signs a release.
export function signer(): (bytes: Uint8Array) => string {
  const privateKey = process.env.UPDATE_SIGNING_KEY;
  const publicKeys = process.env.NOD_UPDATE_PUBLIC_KEY;
  if (!privateKey || !publicKeys) {
    throw new Error('Set UPDATE_SIGNING_KEY and NOD_UPDATE_PUBLIC_KEY.');
  }
  const key = createPrivateKey(privateKey);
  return (bytes) => {
    const signature = sign(null, bytes, key).toString('base64');
    if (!verifyManifest(bytes, signature, publicKeys)) {
      throw new Error(
        'UPDATE_SIGNING_KEY doesn’t match NOD_UPDATE_PUBLIC_KEY, which installed copies use.',
      );
    }
    return signature;
  };
}
