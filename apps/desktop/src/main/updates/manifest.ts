import { createPublicKey, verify } from 'node:crypto';
import { releaseTag, testReleaseTag } from './feed.ts';
import { isPrerelease, isVersion } from './version.ts';

export type ReleaseFile = { size: number; sha256: string };

export type Manifest = {
  version: string;
  tag: string;
  files: Map<string, ReleaseFile>;
};

const ed25519SpkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
const fileName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const sha256 = /^[0-9a-f]{64}$/;

function isPublicKey(key: string): boolean {
  return /^[A-Za-z0-9+/]{43}=$/.test(key);
}

// One raw 32-byte Ed25519 public key in base64, as the release key script
// prints it, or two separated by a comma: the current key and the next one,
// so a release signed with the next key can be trusted before it's needed.
export function releaseKeys(value: string): string[] | null {
  const keys = value.split(',').map((key) => key.trim());
  return keys.length <= 2 && keys.every(isPublicKey) ? keys : null;
}

function verifyWith(
  bytes: Uint8Array,
  signature: Buffer,
  publicKey: string,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ed25519SpkiPrefix, Buffer.from(publicKey, 'base64')]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, bytes, key, signature);
  } catch {
    return false;
  }
}

export function verifyManifest(
  bytes: Uint8Array,
  signature: string,
  keys: string,
): boolean {
  const trusted = releaseKeys(keys);
  const decoded = Buffer.from(signature.trim(), 'base64');
  return (
    trusted !== null && trusted.some((key) => verifyWith(bytes, decoded, key))
  );
}

function field(raw: object, key: string): unknown {
  return Reflect.get(raw, key);
}

function parseFile(raw: unknown): ReleaseFile | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const size = field(raw, 'size');
  const hash = field(raw, 'sha256');
  return typeof size === 'number' &&
    Number.isSafeInteger(size) &&
    size > 0 &&
    typeof hash === 'string' &&
    sha256.test(hash)
    ? { size, sha256: hash }
    : null;
}

export function parseManifest(raw: unknown): Manifest | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const version = field(raw, 'version');
  const tag = field(raw, 'tag');
  const files = field(raw, 'files');
  if (
    typeof version !== 'string' ||
    !isVersion(version) ||
    isPrerelease(version) ||
    (tag !== releaseTag(version) && tag !== testReleaseTag(version)) ||
    typeof files !== 'object' ||
    files === null
  ) {
    return null;
  }
  const parsed = new Map<string, ReleaseFile>();
  for (const [name, entry] of Object.entries(files)) {
    const file = parseFile(entry);
    if (!fileName.test(name) || file === null) {
      return null;
    }
    parsed.set(name, file);
  }
  return { version, tag, files: parsed };
}
