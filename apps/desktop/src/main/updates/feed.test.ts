import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  pickTestRelease,
  releasesApi,
  updateBase,
  updateFeed,
} from './feed.ts';

const base = 'https://github.com/owner/repo/releases';

describe('updateBase', () => {
  it('accepts an https address and drops a trailing slash', () => {
    assert.equal(updateBase(`${base}/`), base);
    assert.equal(updateBase(base), base);
  });

  it('refuses addresses that are not plain https', () => {
    for (const bad of [
      'http://github.com/owner/repo/releases',
      'https://user:pass@github.com/owner/repo/releases',
      `${base}?x=1`,
      `${base}#top`,
      'github.com/owner/repo/releases',
      '',
    ]) {
      assert.equal(updateBase(bad), null, bad);
    }
  });
});

describe('updateFeed', () => {
  it('reads stable releases from latest and a release’s files from its tag', () => {
    const feed = updateFeed(base);
    assert.equal(feed.stable, `${base}/latest/download`);
    assert.equal(
      feed.files('desktop-v1.3.0'),
      `${base}/download/desktop-v1.3.0`,
    );
    assert.equal(feed.page('desktop-v1.3.0'), `${base}/tag/desktop-v1.3.0`);
    assert.equal(
      feed.releases,
      'https://api.github.com/repos/owner/repo/releases?per_page=30',
    );
  });

  it('has no test channel off GitHub', () => {
    assert.equal(releasesApi('https://example.com/nod/releases'), null);
    assert.equal(releasesApi('https://github.com/owner/repo'), null);
    assert.equal(releasesApi('https://github.com/a/b/c/releases'), null);
  });
});

describe('pickTestRelease', () => {
  const release = (tag_name: string, draft = false) => ({ tag_name, draft });

  it('takes the newest desktop release, test or not', () => {
    assert.equal(
      pickTestRelease([
        release('desktop-v1.2.0'),
        release('desktop-test-v1.3.0'),
        release('relay-v9.0.0'),
        release('desktop-v1.10.0', true),
      ]),
      'desktop-test-v1.3.0',
    );
  });

  it('prefers the release over the test release of the same version', () => {
    assert.equal(
      pickTestRelease([
        release('desktop-test-v1.3.0'),
        release('desktop-v1.3.0'),
      ]),
      'desktop-v1.3.0',
    );
    assert.equal(
      pickTestRelease([
        release('desktop-v1.3.0'),
        release('desktop-test-v1.3.0'),
      ]),
      'desktop-v1.3.0',
    );
  });

  it('ignores anything it can’t read', () => {
    assert.equal(pickTestRelease({}), null);
    assert.equal(
      pickTestRelease([
        null,
        { tag_name: 'desktop-v1.4.0' },
        release('desktop-v1.4.0-beta.1'),
        release('desktop-vx'),
      ]),
      null,
    );
  });
});
