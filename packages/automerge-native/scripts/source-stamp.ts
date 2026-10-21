import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const inputs = [
  'rust/Cargo.toml',
  'rust/Cargo.lock',
  'rust/rust-toolchain.toml',
  'ios/nod_automerge.h',
  'scripts/build-ios.ts',
  'scripts/cargo.ts',
  'scripts/source-stamp.ts',
];

/** A hash of everything the iOS library is built from, and how. */
export async function sourceStamp(root: string): Promise<string> {
  const sources = await readdir(path.join(root, 'rust', 'src'), {
    recursive: true,
    withFileTypes: true,
  });
  const files = [
    ...inputs,
    ...sources
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path
          .relative(root, path.join(entry.parentPath, entry.name))
          .split(path.sep)
          .join('/'),
      ),
  ];
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    hash.update(file);
    hash.update(await readFile(path.join(root, file)));
  }
  return hash.digest('hex');
}
