import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { isNewer, isPrerelease, isVersion } from './version.ts';

describe('isNewer', () => {
  it('orders releases by major, minor and patch numerically', () => {
    assert.equal(isNewer('1.2.10', '1.2.9'), true);
    assert.equal(isNewer('1.10.0', '1.9.9'), true);
    assert.equal(isNewer('2.0.0', '1.99.99'), true);
    assert.equal(isNewer('1.2.9', '1.2.10'), false);
  });

  it('never offers the version already running', () => {
    assert.equal(isNewer('1.2.0', '1.2.0'), false);
    assert.equal(isNewer('1.2.0-beta.1', '1.2.0-beta.1'), false);
  });

  it('never offers an older stable release to someone on a beta', () => {
    assert.equal(isNewer('1.2.0', '1.3.0-beta.1'), false);
  });

  it('offers the release a beta led up to', () => {
    assert.equal(isNewer('1.3.0', '1.3.0-beta.4'), true);
    assert.equal(isNewer('1.3.0-beta.4', '1.3.0'), false);
  });

  it('orders prerelease identifiers by semantic versioning rules', () => {
    assert.equal(isNewer('1.0.0-beta.11', '1.0.0-beta.2'), true);
    assert.equal(isNewer('1.0.0-beta', '1.0.0-alpha.9'), true);
    assert.equal(isNewer('1.0.0-alpha.beta', '1.0.0-alpha.1'), true);
    assert.equal(isNewer('1.0.0-alpha.1', '1.0.0-alpha'), true);
    assert.equal(isNewer('1.0.0-alpha', '1.0.0-alpha.1'), false);
  });

  it('refuses anything that is not a plain version', () => {
    for (const bad of [
      '',
      'v1.2.0',
      '1.2',
      '1.2.0.1',
      '01.2.0',
      '1.2.0+build',
      '1.2.0-',
      '1.2.0-beta..1',
      '1.2.0-01',
      ' 1.2.0',
      '99999999999999999.0.0',
    ]) {
      assert.equal(isNewer(bad, '1.0.0'), false, bad);
      assert.equal(isVersion(bad), false, bad);
    }
  });
});

describe('isPrerelease', () => {
  it('tells a beta from a release', () => {
    assert.equal(isPrerelease('1.3.0-beta.1'), true);
    assert.equal(isPrerelease('1.3.0'), false);
    assert.equal(isPrerelease('nope'), false);
  });
});
