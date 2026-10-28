import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { releaseKey } from '../testing/release-key.ts';
import { parseManifest, verifyManifest } from './manifest.ts';

const hash = 'a'.repeat(64);
const body = {
  version: '1.3.0',
  tag: 'desktop-v1.3.0',
  files: { RELEASES: { size: 80, sha256: hash } },
};

describe('verifyManifest', () => {
  it('accepts bytes signed with the release key', () => {
    const key = releaseKey();
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    assert.equal(verifyManifest(bytes, key.sign(bytes), key.publicKey), true);
  });

  it('accepts a manifest signed with the next key, listed after the current one', () => {
    const current = releaseKey();
    const next = releaseKey();
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    assert.equal(
      verifyManifest(
        bytes,
        next.sign(bytes),
        `${current.publicKey},${next.publicKey}`,
      ),
      true,
    );
  });

  it('refuses more than two keys or a damaged one', () => {
    const key = releaseKey();
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    const three = [key.publicKey, key.publicKey, key.publicKey].join(',');
    assert.equal(verifyManifest(bytes, key.sign(bytes), three), false);
    assert.equal(
      verifyManifest(bytes, key.sign(bytes), `${key.publicKey},x`),
      false,
    );
  });

  it('refuses changed bytes, another key and junk', () => {
    const key = releaseKey();
    const other = releaseKey();
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    const changed = new TextEncoder().encode(
      JSON.stringify({ ...body, version: '1.4.0' }),
    );
    assert.equal(
      verifyManifest(changed, key.sign(bytes), key.publicKey),
      false,
    );
    assert.equal(
      verifyManifest(bytes, other.sign(bytes), key.publicKey),
      false,
    );
    assert.equal(verifyManifest(bytes, 'not base64!', key.publicKey), false);
    assert.equal(verifyManifest(bytes, key.sign(bytes), ''), false);
  });
});

describe('parseManifest', () => {
  it('reads the version, tag and files', () => {
    assert.deepEqual(parseManifest(body), {
      version: '1.3.0',
      tag: 'desktop-v1.3.0',
      files: new Map([['RELEASES', { size: 80, sha256: hash }]]),
    });
  });

  it('accepts the test release of the same version', () => {
    assert.equal(
      parseManifest({ ...body, tag: 'desktop-test-v1.3.0' })?.tag,
      'desktop-test-v1.3.0',
    );
  });

  it('refuses a tag of another version', () => {
    assert.equal(parseManifest({ ...body, tag: 'desktop-v1.2.0' }), null);
  });

  it('refuses file names that could leave the folder, and bad entries', () => {
    for (const files of [
      { '../RELEASES': { size: 80, sha256: hash } },
      { 'a/b': { size: 80, sha256: hash } },
      { RELEASES: { size: 0, sha256: hash } },
      { RELEASES: { size: 80, sha256: 'ABC' } },
      { RELEASES: null },
    ]) {
      assert.equal(parseManifest({ ...body, files }), null);
    }
  });
});
