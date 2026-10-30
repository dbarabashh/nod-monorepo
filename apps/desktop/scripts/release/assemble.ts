import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { releaseNotes } from '../../../../scripts/release/changelog.ts';
import {
  checksums,
  manifestFile,
  releaseManifest,
  signatureFile,
  type ReleaseFile,
} from '../../../../scripts/release/manifest.ts';
import {
  digest,
  sha256File,
  signer,
} from '../../../../scripts/release/sign.ts';
import {
  isPrerelease,
  isVersion,
} from '../../../../scripts/release/version.ts';
import {
  releaseTag,
  testReleaseTag,
  updateBase,
} from '../../src/main/updates/feed.ts';
import { macFeeds, compareAssets, releaseAssets } from './assets.ts';

const appDir = path.resolve(import.meta.dirname, '../..');

type Manifest = { version: string; productName: string; name: string };

async function readManifest(): Promise<Manifest> {
  const parsed: unknown = JSON.parse(
    await readFile(path.join(appDir, 'package.json'), 'utf8'),
  );
  const field = (key: string): unknown =>
    typeof parsed === 'object' && parsed !== null
      ? Reflect.get(parsed, key)
      : undefined;
  const version = field('version');
  const productName = field('productName');
  const name = field('name');
  if (
    typeof version !== 'string' ||
    typeof productName !== 'string' ||
    typeof name !== 'string'
  ) {
    throw new Error('package.json needs a name, version and productName');
  }
  return { version, productName, name };
}

// The tag starts the release, so it must name the version the build carries;
// the release notes come from CHANGELOG.md, so they must exist.
async function check(
  tag: string | undefined,
): Promise<Manifest & { notes: string }> {
  const manifest = await readManifest();
  if (!isVersion(manifest.version) || isPrerelease(manifest.version)) {
    throw new Error(`${manifest.version} is not a release version.`);
  }
  if (tag !== releaseTag(manifest.version)) {
    throw new Error(
      `Tag ${tag ?? '(none)'} doesn't match package.json, which is at ${manifest.version}.`,
    );
  }
  const notes = releaseNotes(
    await readFile(path.join(appDir, 'CHANGELOG.md'), 'utf8'),
    manifest.version,
  );
  return { ...manifest, notes };
}

type Assets = {
  tag: string | undefined;
  dir: string | undefined;
  url: string | undefined;
  notesFile: string | undefined;
};

async function assemble({ tag, dir, url, notesFile }: Assets) {
  const manifest = await readManifest();
  const stableTag = releaseTag(manifest.version);
  const { version, productName, name, notes } = await check(stableTag);
  const base = url === undefined ? null : updateBase(url);
  if (
    (tag !== stableTag && tag !== testReleaseTag(version)) ||
    dir === undefined ||
    base === null ||
    notesFile === undefined
  ) {
    throw new Error(
      'Usage: assemble.ts assets <desktop-v… or desktop-test-v…> <dir> <releases url> <notes file>',
    );
  }
  const signManifest = signer();
  const files = await readdir(dir);
  const { missing, unexpected } = compareAssets(
    files,
    releaseAssets(productName, name, version),
  );
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `The release is missing [${missing.join(', ')}] and has unexpected [${unexpected.join(', ')}]`,
    );
  }
  const feeds = macFeeds({
    base,
    tag,
    productName,
    version,
    notes,
    publishedAt: new Date().toISOString(),
  });
  for (const name of [
    ...feeds.keys(),
    manifestFile,
    signatureFile,
    'SHA256SUMS',
  ]) {
    if (files.includes(name)) {
      throw new Error(`A build produced ${name}, which the release writes.`);
    }
  }
  const released = new Map<string, ReleaseFile>();
  for (const name of files) {
    const file = path.join(dir, name);
    released.set(name, {
      size: (await stat(file)).size,
      sha256: await sha256File(file),
    });
  }
  const written = new Map<string, Uint8Array>();
  for (const [name, content] of feeds) {
    const bytes = new TextEncoder().encode(content);
    written.set(name, bytes);
    released.set(name, { size: bytes.byteLength, sha256: digest(bytes) });
  }
  const manifestBytes = new TextEncoder().encode(
    releaseManifest(version, tag, released),
  );
  written.set(manifestFile, manifestBytes);
  written.set(
    signatureFile,
    new TextEncoder().encode(`${signManifest(manifestBytes)}\n`),
  );
  const hashes = new Map(
    [...released].map(([name, file]) => [name, file.sha256]),
  );
  for (const [name, bytes] of written) {
    hashes.set(name, digest(bytes));
  }
  written.set('SHA256SUMS', new TextEncoder().encode(checksums(hashes)));
  for (const [name, bytes] of written) {
    await writeFile(path.join(dir, name), bytes);
  }
  await writeFile(notesFile, `${notes}\n`);
}

const [command, ...args] = process.argv.slice(2);
const task =
  command === 'check'
    ? check(args[0])
    : command === 'assets'
      ? assemble({
          tag: args[0],
          dir: args[1],
          url: args[2],
          notesFile: args[3],
        })
      : Promise.reject(new Error('Usage: assemble.ts check|assets …'));

task.catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
