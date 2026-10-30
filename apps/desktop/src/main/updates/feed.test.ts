import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { releasesApi, updateBase, updateFeed } from './feed.ts';

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
