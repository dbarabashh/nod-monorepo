import { execFile } from 'node:child_process';
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  entitlementsFor,
  isBundleExecutable,
  signingOrder,
  type SigningItem,
} from '../macos-signing.ts';

const run = promisify(execFile);

const machOMagics = new Set([
  'feedface',
  'feedfacf',
  'cefaedfe',
  'cffaedfe',
  'cafebabe',
  'bebafeca',
]);

async function isMachO(file: string): Promise<boolean> {
  const handle = await open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4), 0, 4, 0);
    return bytesRead === 4 && machOMagics.has(buffer.toString('hex'));
  } finally {
    await handle.close();
  }
}

async function collect(dir: string): Promise<SigningItem[]> {
  const items: SigningItem[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      items.push(...(await collect(full)));
      if (entry.name.endsWith('.app') || entry.name.endsWith('.framework')) {
        items.push({ path: full, bundle: true });
      }
    } else if (
      entry.isFile() &&
      !isBundleExecutable(full) &&
      (await isMachO(full))
    ) {
      items.push({ path: full, bundle: false });
    }
  }
  return items;
}

// Signs the packaged app the way Forge's osxSign would, with only codesign:
// this runs where the signing identity is, with no dependency installed.
async function sign(app: string | undefined) {
  const identity = process.env.APPLE_SIGNING_IDENTITY;
  const keychain = process.env.APPLE_KEYCHAIN;
  if (app === undefined || !app.endsWith('.app') || !identity) {
    throw new Error(
      'Usage: APPLE_SIGNING_IDENTITY=… sign-macos.ts <path to the .app>',
    );
  }
  const items = signingOrder([
    ...(await collect(app)),
    { path: app, bundle: true },
  ]);
  for (const item of items) {
    await run('codesign', [
      '--force',
      '--sign',
      identity,
      ...(keychain ? ['--keychain', keychain] : []),
      '--timestamp',
      '--options',
      'runtime',
      '--entitlements',
      entitlementsFor(item.path),
      item.path,
    ]);
    console.log(`signed ${path.relative(path.dirname(app), item.path)}`);
  }
  await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
}

sign(process.argv[2]).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
