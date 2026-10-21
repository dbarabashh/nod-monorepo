import { execFile, spawn } from 'node:child_process';
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { requirePackageDir } from './package-dir.ts';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const devDist = path.join(root, '.dev-electron');
const electronDir = requirePackageDir('electron', import.meta.url);

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}

function stringField(value: unknown, key: string): string {
  if (typeof value === 'object' && value !== null && key in value) {
    const field: unknown = Reflect.get(value, key);
    if (typeof field === 'string') {
      return field;
    }
  }
  throw new Error(`Expected a string "${key}"`);
}

// Unpackaged, macOS names and badges the app after the stock Electron bundle.
// A renamed, re-signed copy shows the product name and icon in the Dock instead,
// without touching node_modules, whose signature the OS permissions rely on.
async function prepareMacBundle(): Promise<void> {
  const productName = stringField(
    await readJson(path.join(root, 'package.json')),
    'productName',
  );
  const electronVersion = stringField(
    await readJson(path.join(electronDir, 'package.json')),
    'version',
  );
  const icon = path.join(root, 'build', 'icon.icns');
  const stamp = JSON.stringify({
    productName,
    electronVersion,
    icon: (await stat(icon)).mtimeMs,
  });
  const stampFile = path.join(devDist, 'stamp.json');
  const current = await readFile(stampFile, 'utf8').catch(() => '');
  if (current === stamp) {
    return;
  }

  const stockBundle = path.join(electronDir, 'dist', 'Electron.app');
  if (!(await stat(stockBundle).catch(() => null))) {
    await run(process.execPath, [path.join(electronDir, 'install.js')]);
    if (!(await stat(stockBundle).catch(() => null))) {
      throw new Error(
        'Electron is not downloaded. Unset ELECTRON_SKIP_BINARY_DOWNLOAD and run pnpm start again.',
      );
    }
  }
  const bundle = path.join(devDist, 'Electron.app');
  const plist = path.join(bundle, 'Contents', 'Info.plist');
  await rm(devDist, { recursive: true, force: true });
  await mkdir(devDist, { recursive: true });
  await run('cp', ['-cR', stockBundle, bundle]);
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    await run('plutil', ['-replace', key, '-string', productName, plist]);
  }
  await run('plutil', [
    '-replace',
    'CFBundleIdentifier',
    '-string',
    `com.electron.${productName.toLowerCase().replaceAll(/[^a-z0-9]/g, '')}.dev`,
    plist,
  ]);
  await copyFile(
    icon,
    path.join(bundle, 'Contents', 'Resources', 'electron.icns'),
  );
  await run('codesign', ['--force', '--deep', '--sign', '-', bundle]);
  await writeFile(stampFile, stamp, 'utf8');
}

const env: NodeJS.ProcessEnv = {
  ...process.env,
  NOD_DEV_LAUNCHER: String(process.pid),
};
if (process.platform === 'darwin') {
  await prepareMacBundle();
  env.ELECTRON_OVERRIDE_DIST_PATH = devDist;
}

const forgeCli = path.join(
  requirePackageDir('@electron-forge/cli', import.meta.url),
  'dist',
  'electron-forge.js',
);

const forge = spawn(
  process.execPath,
  [forgeCli, 'start', ...process.argv.slice(2)],
  { cwd: root, env, stdio: 'inherit' },
);
forge.on('exit', (code) => process.exit(code ?? 1));
const forwarded: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
for (const signal of forwarded) {
  process.on(signal, () => forge.kill(signal));
}
