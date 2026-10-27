import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { downloadFile, type Fetch } from '../models/download.ts';
import type { Manifest } from './manifest.ts';

type WindowsStage = {
  manifest: Manifest;
  filesUrl: string;
  directory: string;
  fetch: Fetch;
  signal: AbortSignal;
};

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

// Squirrel.Windows checks no signature, so it never downloads anything
// itself: Nod downloads the package and its RELEASES, checks both against
// the signed manifest, and points Squirrel at the folder that holds them.
export async function stageWindowsRelease(
  stage: WindowsStage,
): Promise<string> {
  const { manifest, filesUrl, directory, fetch, signal } = stage;
  const packages = [...manifest.files.keys()].filter((name) =>
    name.endsWith(`-${manifest.version}-full.nupkg`),
  );
  const packageName = packages.length === 1 ? packages[0] : undefined;
  if (packageName === undefined || !manifest.files.has('RELEASES')) {
    throw new Error('The release has no Windows update.');
  }
  const folder = path.join(directory, manifest.version);
  for (const entry of await readdir(directory).catch(() => [])) {
    if (entry !== manifest.version) {
      await rm(path.join(directory, entry), { recursive: true, force: true });
    }
  }
  await mkdir(folder, { recursive: true });
  for (const name of ['RELEASES', packageName]) {
    const file = manifest.files.get(name);
    if (file === undefined) {
      throw new Error(`The release lists no ${name}.`);
    }
    const destination = path.join(folder, name);
    if ((await sha256(destination).catch(() => null)) !== file.sha256) {
      await rm(destination, { force: true });
    }
    await downloadFile({
      url: `${filesUrl}/${name}`,
      sizeBytes: file.size,
      sha256: file.sha256,
      destination,
      fetch,
      signal,
      onProgress: () => {},
    });
  }
  const entries = (await readFile(path.join(folder, 'RELEASES'), 'utf8'))
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  if (
    entries.length === 0 ||
    !entries.every((line) => line.trim().split(/\s+/)[1] === packageName)
  ) {
    throw new Error('RELEASES names a package the manifest doesn’t.');
  }
  return folder;
}
