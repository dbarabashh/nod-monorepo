import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { apkFile, isReleaseVersion, releaseTag } from './version.mts';

describe('isReleaseVersion', () => {
  it('takes plain versions whose parts fit a build number', () => {
    assert.equal(isReleaseVersion('1.2.3'), true);
    assert.equal(isReleaseVersion('999.999.999'), true);
  });

  it('refuses prereleases, leading zeros and parts of 1000 or more', () => {
    for (const bad of ['1.2.3-beta.1', '01.2.3', '1.1000.0', '1.2', 'v1.2.3']) {
      assert.equal(isReleaseVersion(bad), false, bad);
    }
  });
});

it('tags a release as mobile-v and its version', () => {
  assert.equal(releaseTag('1.2.3'), 'mobile-v1.2.3');
});

it('names the APK as installed copies look for it (src/lib/updates/find.ts)', () => {
  assert.equal(apkFile('1.2.3'), 'Nod-1.2.3.apk');
});
