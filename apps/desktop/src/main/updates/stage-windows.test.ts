import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { Fetch } from '../models/download.ts';
import { useTempDir } from '../testing/temp-dir.ts';
import type { Manifest } from './manifest.ts';
import { stageWindowsRelease } from './stage-windows.ts';

const files = 'https://github.com/owner/repo/releases/download/desktop-v1.3.0';
const pkg = Buffer.from('package bytes');
const releases = Buffer.from(
  `${'0'.repeat(40)} nod_desktop-1.3.0-full.nupkg ${pkg.length}\r\n`,
);
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

function manifestFor(entries: Record<string, Buffer>): Manifest {
  return {
    version: '1.3.0',
    tag: 'desktop-v1.3.0',
    files: new Map(
      Object.entries(entries).map(([name, data]) => [
        name,
        { size: data.length, sha256: sha(data) },
      ]),
    ),
  };
}

function serve(content: Record<string, Buffer>): Fetch {
  return async (url) => {
    const name = url.slice(files.length + 1);
    const body = content[name];
    return body
      ? new Response(new Uint8Array(body))
      : new Response(null, { status: 404 });
  };
}

const signal = new AbortController().signal;

describe('stageWindowsRelease', () => {
  const dir = useTempDir('stage-windows-');

  it('downloads the package and RELEASES the manifest vouches for', async () => {
    const content = {
      RELEASES: releases,
      'nod_desktop-1.3.0-full.nupkg': pkg,
    };
    const folder = await stageWindowsRelease({
      manifest: manifestFor(content),
      filesUrl: files,
      directory: dir(),
      fetch: serve(content),
      signal,
    });
    assert.equal(folder, join(dir(), '1.3.0'));
    assert.deepEqual((await readdir(folder)).toSorted(), [
      'RELEASES',
      'nod_desktop-1.3.0-full.nupkg',
    ]);
    assert.deepEqual(
      await readFile(join(folder, 'nod_desktop-1.3.0-full.nupkg')),
      pkg,
    );
  });

  it('refuses a package that differs from the manifest', async () => {
    const content = {
      RELEASES: releases,
      'nod_desktop-1.3.0-full.nupkg': pkg,
    };
    await assert.rejects(
      stageWindowsRelease({
        manifest: manifestFor(content),
        filesUrl: files,
        directory: dir(),
        fetch: serve({
          ...content,
          'nod_desktop-1.3.0-full.nupkg': Buffer.from('evil'),
        }),
        signal,
      }),
      /checksum/,
    );
    assert.deepEqual(await readdir(join(dir(), '1.3.0')), ['RELEASES']);
  });

  it('refuses RELEASES that names another package', async () => {
    const other = Buffer.from(
      `${'0'.repeat(40)} nod_desktop-1.0.0-full.nupkg 10\n`,
    );
    const content = {
      RELEASES: other,
      'nod_desktop-1.3.0-full.nupkg': pkg,
    };
    await assert.rejects(
      stageWindowsRelease({
        manifest: manifestFor(content),
        filesUrl: files,
        directory: dir(),
        fetch: serve(content),
        signal,
      }),
      /names a package the manifest doesn’t/,
    );
  });

  it('replaces a staged file that no longer matches, even of the same size', async () => {
    const content = {
      RELEASES: releases,
      'nod_desktop-1.3.0-full.nupkg': pkg,
    };
    await mkdir(join(dir(), '1.3.0'), { recursive: true });
    await writeFile(
      join(dir(), '1.3.0', 'RELEASES'),
      Buffer.alloc(releases.length, 'x'),
    );
    const folder = await stageWindowsRelease({
      manifest: manifestFor(content),
      filesUrl: files,
      directory: dir(),
      fetch: serve(content),
      signal,
    });
    assert.deepEqual(await readFile(join(folder, 'RELEASES')), releases);
  });

  it('reads RELEASES written with a byte order mark', async () => {
    const withBom = Buffer.concat([Buffer.from('\ufeff'), releases]);
    const content = {
      RELEASES: withBom,
      'nod_desktop-1.3.0-full.nupkg': pkg,
    };
    assert.equal(
      await stageWindowsRelease({
        manifest: manifestFor(content),
        filesUrl: files,
        directory: dir(),
        fetch: serve(content),
        signal,
      }),
      join(dir(), '1.3.0'),
    );
  });

  it('removes packages staged for other versions', async () => {
    await mkdir(join(dir(), '1.2.0'), { recursive: true });
    await writeFile(join(dir(), '1.2.0', 'RELEASES'), 'old');
    const content = {
      RELEASES: releases,
      'nod_desktop-1.3.0-full.nupkg': pkg,
    };
    await stageWindowsRelease({
      manifest: manifestFor(content),
      filesUrl: files,
      directory: dir(),
      fetch: serve(content),
      signal,
    });
    assert.deepEqual(await readdir(dir()), ['1.3.0']);
  });

  it('refuses a release without a Windows package', async () => {
    await assert.rejects(
      stageWindowsRelease({
        manifest: manifestFor({ RELEASES: releases }),
        filesUrl: files,
        directory: dir(),
        fetch: serve({ RELEASES: releases }),
        signal,
      }),
      /no Windows update/,
    );
  });
});
