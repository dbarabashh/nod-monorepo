import {
  isPrerelease,
  isVersion,
} from '../../../../scripts/release/version.ts';

// app.config.js turns a version into the build number both stores order
// builds by, which leaves each part below 1000.
const smallParts = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export const releaseTagPrefix = 'mobile-v';

export function releaseTag(version: string): string {
  return `${releaseTagPrefix}${version}`;
}

export function isReleaseVersion(version: string): boolean {
  return (
    isVersion(version) && !isPrerelease(version) && smallParts.test(version)
  );
}

export function apkFile(version: string): string {
  return `Nod-${version}.apk`;
}
