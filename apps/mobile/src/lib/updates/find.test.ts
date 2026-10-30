import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  apkFile,
  findUpdate,
  nextPage,
  releasesApi,
  type Fetcher,
} from './find.ts';

const releases = 'https://github.com/example/nod/releases';
const apkHash = 'b'.repeat(64);

// Ed25519 signatures are deterministic: these were made once with Node's
// crypto from a test key whose 32-byte seed is all 0x01, and another key
// (seed 0x02) for the forged one.
const publicKey = 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=';

const manifest = {
  version: '1.3.0',
  tag: 'mobile-v1.3.0',
  files: { 'Nod-1.3.0.apk': { size: 150_000_000, sha256: apkHash } },
};
const manifestSignature =
  '94UqACssNfgy0+9uFXSqeUW3pQJof4kTo1lEN78674P019Evw7yiAuPDOskIHyvwXKrQX189/CGyDWJybapiDQ==';
const forgedSignature =
  'Tw/pouSmRakhLEkq/aV+1yESC+icuv5it7cm5ENqMcMNUcFj0GaBt/eGM5a8zATav62BF5alugup+sJDMEjiAw==';
const replayed = { ...manifest, version: '1.1.0', tag: 'mobile-v1.1.0' };
const replayedSignature =
  'WBn+F3959Vqaz2EQL7VBAV156yTWUyNceaWaPuTQCzHHR3Y5+9SANi6QYRZs3WFuew+NgBBhL/vupdsfifvbCA==';
const withoutApk = { ...manifest, files: {} };
const withoutApkSignature =
  'FRtJ6yXs5nnYQ4zowoNUiesRPHQCQxqm2ly3b+PlmNmMSxlnJ21bXoli91dnZ1pAAAbNlGOoMtZzHZA2MvCjDQ==';

const list = [
  { tag_name: 'desktop-v9.0.0', draft: false, prerelease: false },
  { tag_name: 'mobile-v1.3.0', draft: false, prerelease: false },
];

function fetcher(
  signed: unknown,
  signature: string,
): Fetcher & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    page: async (url) => {
      urls.push(url);
      return { body: list, next: null };
    },
    bytes: async (url) => {
      urls.push(url);
      return new TextEncoder().encode(`${JSON.stringify(signed, null, 2)}\n`);
    },
    text: async (url) => {
      urls.push(url);
      return `${signature}\n`;
    },
  };
}

describe('findUpdate', () => {
  it('offers a newer release signed by the release key', async () => {
    const source = fetcher(manifest, manifestSignature);
    const update = await findUpdate({ releases, publicKey }, '1.2.0', source);
    assert.deepEqual(update, {
      version: '1.3.0',
      tag: 'mobile-v1.3.0',
      url: 'https://github.com/example/nod/releases/download/mobile-v1.3.0/Nod-1.3.0.apk',
      page: 'https://github.com/example/nod/releases/tag/mobile-v1.3.0',
      size: 150_000_000,
      sha256: apkHash,
    });
    assert.deepEqual(source.urls, [
      'https://api.github.com/repos/example/nod/releases?per_page=100',
      'https://github.com/example/nod/releases/download/mobile-v1.3.0/latest.json',
      'https://github.com/example/nod/releases/download/mobile-v1.3.0/latest.json.sig',
    ]);
  });

  it('offers nothing when the newest release is the one running', async () => {
    const source = fetcher(manifest, manifestSignature);
    assert.equal(
      await findUpdate({ releases, publicKey }, '1.3.0', source),
      null,
    );
    assert.equal(source.urls.length, 1);
  });

  it('refuses a manifest signed by another key', async () => {
    await assert.rejects(
      findUpdate(
        { releases, publicKey },
        '1.2.0',
        fetcher(manifest, forgedSignature),
      ),
      /isn't signed by Nod's release key/,
    );
  });

  it("refuses a signed manifest of another release, so an old one can't be replayed", async () => {
    await assert.rejects(
      findUpdate(
        { releases, publicKey },
        '1.2.0',
        fetcher(replayed, replayedSignature),
      ),
      /names another release/,
    );
  });

  it('refuses a release without its APK', async () => {
    await assert.rejects(
      findUpdate(
        { releases, publicKey },
        '1.2.0',
        fetcher(withoutApk, withoutApkSignature),
      ),
      /has no Nod-1.3.0.apk/,
    );
  });
});

describe('releasesApi', () => {
  it('reads only GitHub releases pages', () => {
    assert.equal(
      releasesApi(releases),
      'https://api.github.com/repos/example/nod/releases?per_page=100',
    );
    assert.equal(releasesApi('https://example.org/releases'), null);
    assert.equal(releasesApi('http://github.com/example/nod/releases'), null);
  });
});

it('names the APK after its version', () => {
  assert.equal(apkFile('1.3.0'), 'Nod-1.3.0.apk');
});

const desktopOnly = [
  { tag_name: 'desktop-v9.0.0', draft: false, prerelease: false },
  { tag_name: 'desktop-test-v9.0.0', draft: false, prerelease: true },
];

function paged(pages: unknown[]): Fetcher & { urls: string[] } {
  const base = fetcher(manifest, manifestSignature);
  return {
    ...base,
    page: async (url) => {
      base.urls.push(url);
      const index = Number(new URL(url).searchParams.get('page') ?? '1') - 1;
      const next =
        index + 1 < pages.length
          ? `https://api.github.com/repos/example/nod/releases?per_page=100&page=${index + 2}`
          : null;
      return { body: pages[index], next };
    },
  };
}

describe('findUpdate across pages', () => {
  it('finds a phone release behind pages of desktop releases', async () => {
    const source = paged([desktopOnly, desktopOnly, list]);
    const update = await findUpdate({ releases, publicKey }, '1.2.0', source);
    assert.equal(update?.version, '1.3.0');
    assert.deepEqual(source.urls.slice(0, 3), [
      'https://api.github.com/repos/example/nod/releases?per_page=100',
      'https://api.github.com/repos/example/nod/releases?per_page=100&page=2',
      'https://api.github.com/repos/example/nod/releases?per_page=100&page=3',
    ]);
  });

  it('stops after three pages', async () => {
    const source = paged([desktopOnly, desktopOnly, desktopOnly, list]);
    assert.equal(
      await findUpdate({ releases, publicKey }, '1.2.0', source),
      null,
    );
    assert.equal(source.urls.length, 3);
  });
});

describe('nextPage', () => {
  it("follows only GitHub's own next link", () => {
    assert.equal(
      nextPage(
        '<https://api.github.com/repositories/1/releases?page=2>; rel="next", <https://api.github.com/repositories/1/releases?page=9>; rel="last"',
      ),
      'https://api.github.com/repositories/1/releases?page=2',
    );
    assert.equal(
      nextPage('<https://example.org/releases?page=2>; rel="next"'),
      null,
    );
    assert.equal(
      nextPage('<https://api.github.com/x?page=1>; rel="prev"'),
      null,
    );
    assert.equal(nextPage(null), null);
  });
});
