import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { Manifest } from './manifest.ts';
import { stageMacRelease } from './stage-mac.ts';

const files = 'https://github.com/owner/repo/releases/download/desktop-v1.3.0';
const zip = 'Nod-darwin-arm64-1.3.0.zip';

function feed(url: string, version = '1.3.0') {
  return Buffer.from(
    JSON.stringify({
      currentRelease: version,
      releases: [{ version, updateTo: { version, url } }],
    }),
  );
}

function manifestFor(body: Buffer): Manifest {
  return {
    version: '1.3.0',
    tag: 'desktop-v1.3.0',
    files: new Map([
      [
        'RELEASES-darwin-arm64.json',
        {
          size: body.length,
          sha256: createHash('sha256').update(body).digest('hex'),
        },
      ],
      [zip, { size: 100, sha256: 'c'.repeat(64) }],
    ]),
  };
}

function stage(manifest: Manifest, served: Buffer) {
  return stageMacRelease({
    manifest,
    arch: 'arm64',
    filesUrl: files,
    zipName: (arch, version) => `Nod-darwin-${arch}-${version}.zip`,
    fetchBytes: async (url) => {
      assert.equal(url, `${files}/RELEASES-darwin-arm64.json`);
      return served;
    },
  });
}

describe('stageMacRelease', () => {
  it('hands Squirrel the feed the signed manifest vouches for', async () => {
    const body = feed(`${files}/${zip}`);
    assert.equal(
      await stage(manifestFor(body), body),
      `${files}/RELEASES-darwin-arm64.json`,
    );
  });

  it('refuses a feed that differs from the manifest', async () => {
    const body = feed(`${files}/${zip}`);
    const other = feed(
      'https://github.com/owner/repo/releases/download/desktop-v1.0.0/Nod-darwin-arm64-1.0.0.zip',
      '1.0.0',
    );
    await assert.rejects(
      stage(manifestFor(body), other),
      /doesn’t match the signed manifest/,
    );
  });

  it('refuses a signed feed that points at another release’s ZIP', async () => {
    const body = feed(
      'https://github.com/owner/repo/releases/download/desktop-v1.0.0/Nod-darwin-arm64-1.0.0.zip',
    );
    await assert.rejects(
      stage(manifestFor(body), body),
      /names another release/,
    );
  });

  it('refuses a release without an update for this architecture', async () => {
    const body = feed(`${files}/${zip}`);
    const manifest = manifestFor(body);
    manifest.files.delete(zip);
    await assert.rejects(stage(manifest, body), /no update for arm64/);
  });
});
