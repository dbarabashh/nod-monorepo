import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { checkInstaller, type Pins } from './check-windows.ts';
import { codeSections, resource } from './pe.ts';

const run = promisify(execFile);

// A PE32 file with the given code and, optionally, a .rsrc section holding
// one resource of type "DATA" and id 131, laid out as Windows does.
function pe(code: string, data?: Uint8Array): Buffer {
  const sections: Array<[string, Buffer]> = [['.text', Buffer.from(code)]];
  if (data) {
    const rva = 0x1000 * 2;
    const tree = Buffer.alloc(100);
    tree.writeUInt16LE(1, 12);
    tree.writeUInt32LE((0x80000000 | 88) >>> 0, 16);
    tree.writeUInt32LE((0x80000000 | 24) >>> 0, 20);
    tree.writeUInt16LE(1, 24 + 14);
    tree.writeUInt32LE(131, 24 + 16);
    tree.writeUInt32LE((0x80000000 | 48) >>> 0, 24 + 20);
    tree.writeUInt16LE(1, 48 + 14);
    tree.writeUInt32LE(0x409, 48 + 16);
    tree.writeUInt32LE(72, 48 + 20);
    tree.writeUInt32LE(rva + 100, 72);
    tree.writeUInt32LE(data.length, 76);
    tree.writeUInt16LE(4, 88);
    tree.write('DATA', 90, 'utf16le');
    sections.push(['.rsrc', Buffer.concat([tree, data])]);
  }
  const optionalSize = 96 + 16 * 8;
  const table = 0x40 + 24 + optionalSize;
  const header = Buffer.alloc(table + sections.length * 40);
  header.write('MZ', 0, 'latin1');
  header.writeUInt32LE(0x40, 0x3c);
  header.write('PE\0\0', 0x40, 'latin1');
  header.writeUInt16LE(sections.length, 0x40 + 6);
  header.writeUInt16LE(optionalSize, 0x40 + 20);
  const optional = 0x40 + 24;
  header.writeUInt16LE(0x10b, optional);
  let offset = header.length;
  sections.forEach(([name, body], index) => {
    const entry = table + index * 40;
    header.write(name, entry, 'latin1');
    header.writeUInt32LE(body.length, entry + 8);
    header.writeUInt32LE(0x1000 * (index + 1), entry + 12);
    header.writeUInt32LE(body.length, entry + 16);
    header.writeUInt32LE(offset, entry + 20);
    if (name === '.rsrc') {
      header.writeUInt32LE(0x1000 * (index + 1), optional + 96 + 16);
      header.writeUInt32LE(body.length, optional + 96 + 20);
    }
    offset += body.length;
  });
  return Buffer.concat([header, ...sections.map(([, body]) => body)]);
}

const sha = (bytes: Uint8Array, algorithm = 'sha256') =>
  createHash(algorithm).update(bytes).digest('hex');

const vendorSquirrel = pe('squirrel code');
const vendorStub = pe('stub code');
const vendorSetup = pe('setup code');
const spinner = Buffer.from('gif');
const icon = Buffer.from('ico');

const pins: Pins = {
  code: new Map([
    ['Squirrel.exe', codeSections(vendorSquirrel)],
    ['StubExecutable.exe', codeSections(vendorStub)],
    ['Setup.exe', codeSections(vendorSetup)],
  ]),
  files: new Map([
    ['Squirrel.exe', sha(vendorSquirrel)],
    ['install-spinner.gif', sha(spinner)],
  ]),
};

async function write(root: string, files: Record<string, Uint8Array>) {
  for (const [name, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), bytes);
  }
}

async function zip(target: string, files: Record<string, Uint8Array>) {
  const folder = await mkdtemp(path.join(tmpdir(), 'zip-src-'));
  await write(folder, files);
  await run('zip', ['-q', '-r', '-X', target, ...Object.keys(files)], {
    cwd: folder,
  });
  await rm(folder, { recursive: true, force: true });
}

const signedApp = {
  'Nod.exe': pe('nod app, signed'),
  'ffmpeg.dll': pe('ffmpeg, signed'),
  'resources/app.asar': Buffer.from('app code'),
  'LICENSES.chromium.html': Buffer.from('<html>licenses</html>'),
};

const packageName = 'nod_desktop-1.2.0-full.nupkg';

function packageFiles(
  overrides: Record<string, Uint8Array> = {},
): Record<string, Uint8Array> {
  return {
    '[Content_Types].xml': Buffer.from('<Types/>'),
    'nod_desktop.nuspec': Buffer.from('<package/>'),
    'lib/net45/Nod.exe': signedApp['Nod.exe'],
    'lib/net45/ffmpeg.dll': signedApp['ffmpeg.dll'],
    'lib/net45/resources/app.asar': signedApp['resources/app.asar'],
    'lib/net45/squirrel.exe': pe('squirrel code', Buffer.from('nod icon')),
    'lib/net45/Nod_ExecutionStub.exe': pe('stub code', Buffer.from('version')),
    ...overrides,
  };
}

describe('checkInstaller', () => {
  let root = '';
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'check-windows-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function installer(
    options: {
      package?: Record<string, Uint8Array>;
      embedded?: (
        files: Record<string, Uint8Array>,
      ) => Record<string, Uint8Array>;
      setupCode?: string;
    } = {},
  ) {
    const signed = path.join(root, 'signed');
    const made = path.join(root, 'made');
    await write(signed, signedApp);
    await mkdir(made, { recursive: true });
    const nupkg = path.join(made, packageName);
    await zip(nupkg, options.package ?? packageFiles());
    const packageBytes = await readFile(nupkg);
    const releases = Buffer.from(
      `${sha(packageBytes, 'sha1').toUpperCase()} ${packageName} ${packageBytes.length}`,
    );
    await writeFile(path.join(made, 'RELEASES'), releases);
    const embeddedFiles = {
      'Update.exe': vendorSquirrel,
      [packageName]: packageBytes,
      RELEASES: releases,
      'background.gif': spinner,
      'setupIcon.ico': icon,
    };
    const embeddedZip = path.join(root, 'embedded.zip');
    await zip(embeddedZip, options.embedded?.(embeddedFiles) ?? embeddedFiles);
    await writeFile(
      path.join(made, 'Nod-1.2.0-Setup.exe'),
      pe(options.setupCode ?? 'setup code', await readFile(embeddedZip)),
    );
    return { signed, made, pins, icon };
  }

  it('accepts an installer that carries the signed app and Squirrel’s own code', async () => {
    await checkInstaller(await installer());
  });

  it('refuses an app file changed after signing', async () => {
    await assert.rejects(
      checkInstaller(
        await installer({
          package: packageFiles({
            'lib/net45/resources/app.asar': Buffer.from('other code'),
          }),
        }),
      ),
      /resources\/app\.asar in the package isn’t the signed one/,
    );
  });

  it('refuses a file Squirrel would install from another lib folder', async () => {
    await assert.rejects(
      checkInstaller(
        await installer({
          package: packageFiles({ 'lib/net46/version.dll': pe('evil') }),
        }),
      ),
      /unexpected entry: lib\/net46\/version\.dll/,
    );
  });

  it('refuses a launcher stub with code of its own', async () => {
    await assert.rejects(
      checkInstaller(
        await installer({
          package: packageFiles({
            'lib/net45/Nod_ExecutionStub.exe': pe('evil stub'),
          }),
        }),
      ),
      /Nod_ExecutionStub\.exe in the package isn’t Squirrel’s/,
    );
  });

  it('refuses a package that leaves out a signed binary', async () => {
    const files = packageFiles();
    delete files['lib/net45/ffmpeg.dll'];
    await assert.rejects(
      checkInstaller(await installer({ package: files })),
      /leaves out the signed ffmpeg\.dll/,
    );
  });

  it('refuses a Setup.exe that installs another package', async () => {
    await assert.rejects(
      checkInstaller(
        await installer({
          embedded: (files) => ({ ...files, [packageName]: Buffer.from('x') }),
        }),
      ),
      /Setup\.exe carries a different nod_desktop-1\.2\.0-full\.nupkg\./,
    );
  });

  it('refuses a Setup.exe that carries extra files', async () => {
    await assert.rejects(
      checkInstaller(
        await installer({
          embedded: (files) => ({ ...files, 'version.dll': pe('evil') }),
        }),
      ),
      /Setup\.exe carries unexpected files/,
    );
  });

  it('refuses a package that repeats an entry, which Squirrel would install last', async () => {
    const options = await installer();
    const nupkg = path.join(options.made, packageName);
    const entries = Object.entries(packageFiles()).map(
      ([name, data]): [string, Buffer] => [name, Buffer.from(data)],
    );
    await writeFile(
      nupkg,
      rawZip([...entries, ['lib/net45/Nod.exe', pe('tampered')]]),
    );
    const bytes = await readFile(nupkg);
    await writeFile(
      path.join(options.made, 'RELEASES'),
      `${sha(bytes, 'sha1')} ${packageName} ${bytes.length}`,
    );
    await assert.rejects(
      checkInstaller(options),
      /repeats lib\/net45\/Nod\.exe/,
    );
  });

  it('refuses a Setup.exe whose own code changed', async () => {
    await assert.rejects(
      checkInstaller(await installer({ setupCode: 'evil setup' })),
      /isn’t Squirrel’s Setup\.exe/,
    );
  });
});

// Stored (uncompressed) entries, which may repeat a name as zip allows.
function rawZip(entries: Array<[string, Buffer]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

describe('resource', () => {
  it('finds the package Setup.exe carries', () => {
    assert.deepEqual(
      resource(pe('code', Buffer.from('zip bytes')), 'DATA', 131),
      Buffer.from('zip bytes'),
    );
    assert.equal(resource(pe('code', Buffer.from('zip')), 'DATA', 132), null);
    assert.equal(resource(pe('code'), 'DATA', 131), null);
  });
});
