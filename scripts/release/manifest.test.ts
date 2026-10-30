import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { checksums, releaseManifest } from './manifest.ts';

describe('releaseManifest', () => {
  it('lists every file by name, with its size and hash', () => {
    assert.equal(
      releaseManifest(
        '1.2.0',
        'desktop-v1.2.0',
        new Map([
          ['b.zip', { size: 2, sha256: 'bb' }],
          ['RELEASES', { size: 1, sha256: 'aa' }],
        ]),
      ),
      `{
  "version": "1.2.0",
  "tag": "desktop-v1.2.0",
  "files": {
    "RELEASES": {
      "size": 1,
      "sha256": "aa"
    },
    "b.zip": {
      "size": 2,
      "sha256": "bb"
    }
  }
}
`,
    );
  });
});

describe('checksums', () => {
  it('lists files in sha256sum format, sorted by name', () => {
    assert.equal(
      checksums(
        new Map([
          ['b.zip', 'bb'],
          ['RELEASES', 'cc'],
          ['a.dmg', 'aa'],
        ]),
      ),
      'cc  RELEASES\naa  a.dmg\nbb  b.zip\n',
    );
  });
});
