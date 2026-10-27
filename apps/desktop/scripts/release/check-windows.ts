import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { codeSections, resource, sameCode } from './pe.ts';

const run = promisify(execFile);
const buildDir = path.resolve(import.meta.dirname, '../../build');
const pinsFile = path.join(buildDir, 'squirrel-code.json');
const codeFiles = ['Squirrel.exe', 'StubExecutable.exe', 'Setup.exe'];
const releaseFolder = 'lib/net45/';
const packageMetadata = [
  /^\[Content_Types\]\.xml$/,
  /^_rels\/\.rels$/,
  /^[^/]+\.nuspec$/,
  /^package\/services\/metadata\/core-properties\/[0-9a-f]+\.psmdcp$/,
];

export type Pins = {
  code: Map<string, Map<string, string>>;
  files: Map<string, string>;
};

async function filesIn(dir: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await filesIn(path.join(dir, entry.name), relative)));
    } else if (entry.isFile()) {
      found.push(relative);
    } else {
      throw new Error(`${relative} is neither a file nor a folder`);
    }
  }
  return found;
}

const sha = (bytes: Uint8Array, algorithm = 'sha256') =>
  createHash(algorithm).update(bytes).digest('hex');

function stringMap(raw: unknown): Map<string, string> {
  return new Map(
    typeof raw === 'object' && raw !== null
      ? Object.entries(raw).flatMap(([key, value]) =>
          typeof value === 'string' ? [[key, value]] : [],
        )
      : [],
  );
}

async function readPins(): Promise<Pins> {
  const raw: unknown = JSON.parse(await readFile(pinsFile, 'utf8'));
  const field = (key: string): unknown =>
    typeof raw === 'object' && raw !== null ? Reflect.get(raw, key) : null;
  const codeRaw = field('code');
  const code = new Map(
    codeFiles.map((name): [string, Map<string, string>] => [
      name,
      stringMap(
        typeof codeRaw === 'object' && codeRaw !== null
          ? Reflect.get(codeRaw, name)
          : null,
      ),
    ]),
  );
  const files = stringMap(field('files'));
  if (
    [...code.values()].some((sections) => sections.size === 0) ||
    !files.has('Squirrel.exe') ||
    !files.has('install-spinner.gif')
  ) {
    throw new Error(`${pinsFile} is incomplete; run check-windows.ts pin`);
  }
  return { code, files };
}

function pinnedCode(pins: Pins, name: string): Map<string, string> {
  const sections = pins.code.get(name);
  if (sections === undefined) {
    throw new Error(`No pinned code for ${name}`);
  }
  return sections;
}

// Pins electron-winstaller's Squirrel binaries, which the installer and every
// update carry. Run it after electron-winstaller changes, and review the diff.
async function pin(vendor: string | undefined) {
  if (vendor === undefined) {
    throw new Error('Usage: check-windows.ts pin <electron-winstaller/vendor>');
  }
  const code: Record<string, Record<string, string>> = {};
  for (const name of codeFiles) {
    code[name] = Object.fromEntries(
      codeSections(await readFile(path.join(vendor, name))),
    );
  }
  const files = {
    'Squirrel.exe': sha(await readFile(path.join(vendor, 'Squirrel.exe'))),
    'install-spinner.gif': sha(
      await readFile(
        path.join(vendor, '..', 'resources', 'install-spinner.gif'),
      ),
    ),
  };
  await writeFile(pinsFile, `${JSON.stringify({ code, files }, null, 2)}\n`);
}

async function zipEntries(zip: string): Promise<string[]> {
  const { stdout } = await run('unzip', ['-Z1', zip], {
    maxBuffer: 64 << 20,
  });
  const entries = stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.replaceAll('\\', '/'));
  // Squirrel writes a repeated entry over the first, and unzip keeps the
  // first, so a package with one would be checked and installed differently.
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = entry.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`${path.basename(zip)} repeats ${entry}`);
    }
    seen.add(key);
  }
  for (const entry of entries) {
    if (entry.startsWith('/') || entry.split('/').includes('..')) {
      throw new Error(`${path.basename(zip)} has an unsafe entry: ${entry}`);
    }
  }
  return entries;
}

async function unzipTo(zip: string): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'squirrel-'));
  await run('unzip', ['-q', '-n', zip, '-d', folder]);
  return folder;
}

type ReleaseEntry = { sha1: string; name: string; size: string };

function releaseEntry(text: string): ReleaseEntry {
  const fields = text.trim().split(/\s+/);
  const [sha1, name, size] = fields;
  if (
    fields.length !== 3 ||
    sha1 === undefined ||
    name === undefined ||
    size === undefined
  ) {
    throw new Error('RELEASES should list exactly one package');
  }
  return { sha1: sha1.toLowerCase(), name, size };
}

// Squirrel installs whatever sits under any lib/<folder>/ of the package, so
// the package may hold only lib/net45/ and NuGet's own metadata, and
// lib/net45/ only the signed app, Squirrel's updater and its launchers.
async function checkPackage(nupkg: string, signed: string, pins: Pins) {
  const entries = await zipEntries(nupkg);
  for (const entry of entries) {
    if (
      !entry.endsWith('/') &&
      !entry.startsWith(releaseFolder) &&
      !packageMetadata.some((pattern) => pattern.test(entry))
    ) {
      throw new Error(`The package has an unexpected entry: ${entry}`);
    }
  }
  const unpacked = await unzipTo(nupkg);
  const app = path.join(unpacked, ...releaseFolder.split('/'));
  const signedFiles = await filesIn(signed);
  const packaged = new Set<string>();
  for (const file of await filesIn(app)) {
    packaged.add(file);
    const bytes = await readFile(path.join(app, file));
    const vendor =
      file === 'squirrel.exe'
        ? 'Squirrel.exe'
        : /^[^/]+_ExecutionStub\.exe$/.test(file)
          ? 'StubExecutable.exe'
          : null;
    if (vendor !== null) {
      if (!sameCode(codeSections(bytes), pinnedCode(pins, vendor))) {
        throw new Error(`${file} in the package isn’t Squirrel’s.`);
      }
    } else if (
      !signedFiles.includes(file) ||
      sha(bytes) !== sha(await readFile(path.join(signed, file)))
    ) {
      throw new Error(`${file} in the package isn’t the signed one.`);
    }
  }
  for (const file of signedFiles) {
    const bytes = await readFile(path.join(signed, file));
    if (!packaged.has(file) && bytes.toString('latin1', 0, 2) === 'MZ') {
      throw new Error(`The package leaves out the signed ${file}.`);
    }
  }
}

// Setup.exe installs from the zip it carries as a resource, not from the
// package beside it, so that zip has to hold the same package.
async function checkSetup(
  setup: string,
  nupkg: string,
  releases: ReleaseEntry,
  pins: Pins,
  icon: Uint8Array,
) {
  const bytes = await readFile(setup);
  if (!sameCode(codeSections(bytes), pinnedCode(pins, 'Setup.exe'))) {
    throw new Error(`${path.basename(setup)} isn’t Squirrel’s Setup.exe.`);
  }
  const embedded = resource(bytes, 'DATA', 131);
  if (embedded === null) {
    throw new Error(`${path.basename(setup)} carries no package.`);
  }
  const folder = await mkdtemp(path.join(tmpdir(), 'setup-'));
  const zip = path.join(folder, 'embedded.zip');
  await writeFile(zip, embedded);
  const packageName = path.basename(nupkg);
  const expected = [
    'RELEASES',
    'Update.exe',
    'background.gif',
    packageName,
    'setupIcon.ico',
  ];
  const entries = (await zipEntries(zip)).toSorted();
  if (entries.join('\n') !== expected.toSorted().join('\n')) {
    throw new Error(
      `Setup.exe carries unexpected files: ${entries.join(', ')}`,
    );
  }
  const unpacked = await unzipTo(zip);
  const file = (name: string) => readFile(path.join(unpacked, name));
  const checks: Array<[string, boolean]> = [
    [
      'Update.exe',
      sha(await file('Update.exe')) === pins.files.get('Squirrel.exe'),
    ],
    [packageName, sha(await file(packageName)) === sha(await readFile(nupkg))],
    [
      'RELEASES',
      JSON.stringify(releaseEntry(await file('RELEASES').then(String))) ===
        JSON.stringify(releases),
    ],
    [
      'background.gif',
      sha(await file('background.gif')) ===
        pins.files.get('install-spinner.gif'),
    ],
    ['setupIcon.ico', sha(await file('setupIcon.ico')) === sha(icon)],
  ];
  const wrong = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (wrong.length > 0) {
    throw new Error(`Setup.exe carries a different ${wrong.join(', ')}.`);
  }
}

// The installer is made where dependencies are installed, after SignPath
// signed the app, so before it is signed itself this checks that it carries
// exactly the signed app plus Squirrel's own unchanged code.
export async function checkInstaller(options: {
  signed: string;
  made: string;
  pins: Pins;
  icon: Uint8Array;
}): Promise<void> {
  const { signed, made, pins, icon } = options;
  const madeFiles = await readdir(made);
  const packages = madeFiles.filter((name) => name.endsWith('-full.nupkg'));
  const setups = madeFiles.filter((name) => name.endsWith('-Setup.exe'));
  const [packageName] = packages;
  const [setupName] = setups;
  if (
    packages.length !== 1 ||
    setups.length !== 1 ||
    packageName === undefined ||
    setupName === undefined ||
    madeFiles.length !== 3 ||
    !madeFiles.includes('RELEASES')
  ) {
    throw new Error(`Unexpected installer files: ${madeFiles.join(', ')}`);
  }
  const nupkg = path.join(made, packageName);
  const packageBytes = await readFile(nupkg);
  const releases = releaseEntry(
    await readFile(path.join(made, 'RELEASES'), 'utf8'),
  );
  if (
    releases.sha1 !== sha(packageBytes, 'sha1') ||
    releases.name !== packageName ||
    releases.size !== String(packageBytes.length)
  ) {
    throw new Error('RELEASES doesn’t describe the package.');
  }
  await checkPackage(nupkg, signed, pins);
  await checkSetup(path.join(made, setupName), nupkg, releases, pins, icon);
}

async function check(signed: string | undefined, made: string | undefined) {
  if (signed === undefined || made === undefined) {
    throw new Error('Usage: check-windows.ts check <signed app> <installer>');
  }
  await checkInstaller({
    signed,
    made,
    pins: await readPins(),
    icon: await readFile(path.join(buildDir, 'icon.ico')),
  });
  console.log(`${made} carries the signed app.`);
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  const task =
    command === 'pin'
      ? pin(args[0])
      : command === 'check'
        ? check(args[0], args[1])
        : Promise.reject(new Error('Usage: check-windows.ts pin|check …'));

  task.catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
