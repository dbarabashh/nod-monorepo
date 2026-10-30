import { fromBase64 } from '../crypto/encoding.ts';
import { verifyUnframed } from '../crypto/signing.ts';
import { isNewer, isPrerelease, isVersion } from './version.ts';

export type ReleaseFile = { size: number; sha256: string };

export type ReleaseManifest = {
  version: string;
  tag: string;
  files: Map<string, ReleaseFile>;
};

export type Release = { tag: string; version: string };

export const manifestFile = 'latest.json';
export const signatureFile = 'latest.json.sig';
export const mobileReleaseTagPrefix = 'mobile-v';

const publicKey = /^[A-Za-z0-9+/]{43}=$/;
const signature = /^[A-Za-z0-9+/]{86}==$/;
const fileName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const sha256 = /^[0-9a-f]{64}$/;

// One raw 32-byte Ed25519 public key in base64, or two separated by a comma:
// the current release key and the next one, so a release signed with the
// next key is trusted before it's needed.
export function releaseKeys(value: string): Uint8Array[] | null {
  const keys = value.split(',').map((key) => key.trim());
  return keys.length <= 2 && keys.every((key) => publicKey.test(key))
    ? keys.map(fromBase64)
    : null;
}

export function verifyManifest(
  bytes: Uint8Array,
  signatureText: string,
  keys: string,
): boolean {
  const trusted = releaseKeys(keys);
  const text = signatureText.trim();
  if (trusted === null || !signature.test(text)) {
    return false;
  }
  const decoded = fromBase64(text);
  return trusted.some((key) => verifyUnframed(key, decoded, bytes));
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

function isReleaseVersion(version: unknown): version is string {
  return (
    typeof version === 'string' && isVersion(version) && !isPrerelease(version)
  );
}

// Each app names the tags its releases carry; a manifest of another app's
// release is never read as one of its own.
export function parseManifest(
  raw: unknown,
  tagPrefixes: string[],
): ReleaseManifest | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const version = field(raw, 'version');
  const tag = field(raw, 'tag');
  const files = field(raw, 'files');
  if (
    !isReleaseVersion(version) ||
    typeof tag !== 'string' ||
    !tagPrefixes.some((prefix) => tag === `${prefix}${version}`) ||
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

// GitHub has one latest release per repository and it belongs to the desktop
// app, so other apps find their newest release in the list of releases.
// Drafts and prereleases are never offered.
export function newestRelease(raw: unknown, tagPrefix: string): Release | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  let best: Release | null = null;
  for (const release of raw) {
    if (typeof release !== 'object' || release === null) {
      continue;
    }
    const tag = field(release, 'tag_name');
    if (
      field(release, 'draft') !== false ||
      field(release, 'prerelease') !== false ||
      typeof tag !== 'string' ||
      !tag.startsWith(tagPrefix)
    ) {
      continue;
    }
    const version = tag.slice(tagPrefix.length);
    if (
      isReleaseVersion(version) &&
      (best === null || isNewer(version, best.version))
    ) {
      best = { tag, version };
    }
  }
  return best;
}
