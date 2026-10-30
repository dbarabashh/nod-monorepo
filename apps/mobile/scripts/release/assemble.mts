import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { releaseNotes } from '../../../../scripts/release/changelog.ts';
import {
  checksums,
  manifestFile,
  releaseManifest,
  signatureFile,
} from '../../../../scripts/release/manifest.ts';
import { versionIn } from '../../../../scripts/release/prepare.ts';
import {
  digest,
  sha256File,
  signer,
} from '../../../../scripts/release/sign.ts';
import { apkFile, isReleaseVersion, releaseTag } from './version.mts';

const appDir = path.resolve(import.meta.dirname, '../..');

// The tag starts the release, so it must name the version the build carries;
// the release notes come from CHANGELOG.md, so they must exist.
async function check(
  tag: string | undefined,
): Promise<{ version: string; notes: string }> {
  const version = versionIn(
    await readFile(path.join(appDir, 'package.json'), 'utf8'),
  );
  if (!isReleaseVersion(version)) {
    throw new Error(
      `package.json is at ${version}; a release is major.minor.patch, each part below 1000.`,
    );
  }
  if (tag !== releaseTag(version)) {
    throw new Error(
      `Tag ${tag ?? '(none)'} doesn't match package.json, which is at ${version}.`,
    );
  }
  const notes = releaseNotes(
    await readFile(path.join(appDir, 'CHANGELOG.md'), 'utf8'),
    version,
  );
  return { version, notes };
}

// A release holds the one APK the workflow signed and nothing else, so no
// stray file is signed into the manifest installed copies trust.
async function assemble(
  tag: string | undefined,
  dir: string | undefined,
  notesFile: string | undefined,
) {
  if (dir === undefined || notesFile === undefined) {
    throw new Error(
      'Usage: assemble.mts assets <mobile-v…> <dir> <notes file>',
    );
  }
  const { version, notes } = await check(tag);
  const signManifest = signer();
  const apk = apkFile(version);
  const files = await readdir(dir);
  if (files.length !== 1 || files[0] !== apk) {
    throw new Error(
      `The release must hold only ${apk}, not [${files.join(', ')}].`,
    );
  }
  const file = path.join(dir, apk);
  const apkHash = await sha256File(file);
  const manifest = new TextEncoder().encode(
    releaseManifest(
      version,
      releaseTag(version),
      new Map([[apk, { size: (await stat(file)).size, sha256: apkHash }]]),
    ),
  );
  const signature = new TextEncoder().encode(`${signManifest(manifest)}\n`);
  const hashes = new Map([
    [apk, apkHash],
    [manifestFile, digest(manifest)],
    [signatureFile, digest(signature)],
  ]);
  await writeFile(path.join(dir, manifestFile), manifest);
  await writeFile(path.join(dir, signatureFile), signature);
  await writeFile(path.join(dir, 'SHA256SUMS'), checksums(hashes));
  await writeFile(notesFile, `${notes}\n`);
}

const [command, ...args] = process.argv.slice(2);
const task =
  command === 'check'
    ? check(args[0])
    : command === 'assets'
      ? assemble(args[0], args[1], args[2])
      : Promise.reject(new Error('Usage: assemble.mts check|assets …'));

task.catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
