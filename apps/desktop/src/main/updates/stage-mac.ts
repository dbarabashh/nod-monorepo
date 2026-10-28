import { createHash } from 'node:crypto';
import { macFeedFile } from './feed.ts';
import type { Manifest } from './manifest.ts';

type MacStage = {
  manifest: Manifest;
  arch: string;
  filesUrl: string;
  zipName: (arch: string, version: string) => string;
  fetchBytes: (url: string) => Promise<Uint8Array>;
};

function field(raw: unknown, key: string): unknown {
  return typeof raw === 'object' && raw !== null
    ? Reflect.get(raw, key)
    : undefined;
}

// Squirrel.Mac installs any release its feed names, older or not, as long as
// the Developer ID matches. So the feed must be the one the signed manifest
// vouches for, naming this release's own ZIP.
export async function stageMacRelease(stage: MacStage): Promise<string> {
  const { manifest, arch, filesUrl, zipName, fetchBytes } = stage;
  const name = macFeedFile(arch);
  const listed = manifest.files.get(name);
  const zip = zipName(arch, manifest.version);
  if (listed === undefined || !manifest.files.has(zip)) {
    throw new Error(`The release has no update for ${arch}.`);
  }
  const url = `${filesUrl}/${name}`;
  const bytes = await fetchBytes(url);
  if (
    bytes.byteLength !== listed.size ||
    createHash('sha256').update(bytes).digest('hex') !== listed.sha256
  ) {
    throw new Error('The macOS feed doesn’t match the signed manifest.');
  }
  const feed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const releases = field(feed, 'releases');
  const update = Array.isArray(releases)
    ? field(releases.at(0), 'updateTo')
    : undefined;
  if (
    field(feed, 'currentRelease') !== manifest.version ||
    !Array.isArray(releases) ||
    releases.length !== 1 ||
    field(update, 'version') !== manifest.version ||
    field(update, 'url') !== `${filesUrl}/${zip}`
  ) {
    throw new Error('The macOS feed names another release.');
  }
  return url;
}
