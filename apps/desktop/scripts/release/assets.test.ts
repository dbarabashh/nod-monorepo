import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { compareAssets, macFeeds, releaseAssets } from './assets.ts';

const base = 'https://github.com/owner/repo/releases';

const complete = [
  'Nod-darwin-arm64-1.2.0.zip',
  'Nod-1.2.0-arm64.dmg',
  'Nod-darwin-x64-1.2.0.zip',
  'Nod-1.2.0-x64.dmg',
  'Nod.ico',
  'RELEASES',
  'nod_desktop-1.2.0-full.nupkg',
  'Nod-1.2.0-Setup.exe',
  'nod-desktop_1.2.0_amd64.deb',
  'nod-desktop_1.2.0_arm64.deb',
  'nod-desktop-1.2.0-1.x86_64.rpm',
  'nod-desktop-1.2.0-1.arm64.rpm',
];

describe('releaseAssets', () => {
  it('names every installer the workflow builds', () => {
    assert.deepEqual(releaseAssets('Nod', 'nod-desktop', '1.2.0'), complete);
  });
});

describe('compareAssets', () => {
  const expected = releaseAssets('Nod', 'nod-desktop', '1.2.0');

  it('accepts a release with every installer and nothing else', () => {
    assert.deepEqual(compareAssets(complete, expected), {
      missing: [],
      unexpected: [],
    });
  });

  it('names what a failed build left out and what a build added', () => {
    assert.deepEqual(
      compareAssets(
        [
          ...complete.filter(
            (file) =>
              file !== 'Nod-darwin-x64-1.2.0.zip' && file !== 'RELEASES',
          ),
          'a stray.txt',
          'Nod-1.1.0-arm64.dmg',
        ],
        expected,
      ),
      {
        missing: ['Nod-darwin-x64-1.2.0.zip', 'RELEASES'],
        unexpected: ['a stray.txt', 'Nod-1.1.0-arm64.dmg'],
      },
    );
  });
});

describe('macFeeds', () => {
  it('writes a Squirrel.Mac feed per architecture that downloads from its own release', () => {
    const feeds = macFeeds({
      base,
      tag: 'desktop-test-v1.2.0',
      productName: 'Nod',
      version: '1.2.0',
      notes: '- Faster.',
      publishedAt: '2026-10-27T10:00:00.000Z',
    });
    assert.deepEqual(
      [...feeds.keys()],
      ['RELEASES-darwin-arm64.json', 'RELEASES-darwin-x64.json'],
    );
    assert.deepEqual(JSON.parse(feeds.get('RELEASES-darwin-x64.json') ?? ''), {
      currentRelease: '1.2.0',
      releases: [
        {
          version: '1.2.0',
          updateTo: {
            version: '1.2.0',
            name: 'Nod 1.2.0',
            notes: '- Faster.',
            pub_date: '2026-10-27T10:00:00.000Z',
            url: 'https://github.com/owner/repo/releases/download/desktop-test-v1.2.0/Nod-darwin-x64-1.2.0.zip',
          },
        },
      ],
    });
  });
});
