import { isNewer, isPrerelease, isVersion } from './version.ts';

export const releaseTagPrefix = 'desktop-v';
export const testReleaseTagPrefix = 'desktop-test-v';
export const manifestFile = 'latest.json';
export const signatureFile = 'latest.json.sig';

export function macFeedFile(arch: string): string {
  return `RELEASES-darwin-${arch}.json`;
}

export function releaseTag(version: string): string {
  return `${releaseTagPrefix}${version}`;
}

export function testReleaseTag(version: string): string {
  return `${testReleaseTagPrefix}${version}`;
}

// The base follows the layout of a GitHub releases page
// (https://github.com/<owner>/<repo>/releases): <base>/latest/download/<file>
// serves the newest published release that is not a prerelease.
export function updateBase(url: string): string | null {
  const parsed = URL.parse(url);
  if (
    parsed?.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    return null;
  }
  return parsed.href.replace(/\/+$/, '');
}

export type UpdateFeed = {
  stable: string;
  releases: string | null;
  files: (tag: string) => string;
  page: (tag: string) => string;
};

// Test releases are prereleases, which <base>/latest skips, so finding the
// newest one takes GitHub's API. Other hosts get no test channel.
export function releasesApi(base: string): string | null {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/releases$/.exec(
    base,
  );
  return match
    ? `https://api.github.com/repos/${match[1]}/${match[2]}/releases?per_page=30`
    : null;
}

export function updateFeed(base: string): UpdateFeed {
  return {
    stable: `${base}/latest/download`,
    releases: releasesApi(base),
    files: (tag) => `${base}/download/${tag}`,
    page: (tag) => `${base}/tag/${tag}`,
  };
}

function tagVersion(tag: string): string | null {
  const version = tag.startsWith(testReleaseTagPrefix)
    ? tag.slice(testReleaseTagPrefix.length)
    : tag.startsWith(releaseTagPrefix)
      ? tag.slice(releaseTagPrefix.length)
      : null;
  return version !== null && isVersion(version) && !isPrerelease(version)
    ? version
    : null;
}

// The newest desktop release, test or not, from GitHub's list of releases.
// A release keeps the version a test release had, so on a tie it wins.
export function pickTestRelease(raw: unknown): string | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  let best: { tag: string; version: string } | null = null;
  for (const release of raw) {
    if (typeof release !== 'object' || release === null) {
      continue;
    }
    const tag: unknown = Reflect.get(release, 'tag_name');
    if (Reflect.get(release, 'draft') !== false || typeof tag !== 'string') {
      continue;
    }
    const version = tagVersion(tag);
    if (
      version !== null &&
      (best === null ||
        isNewer(version, best.version) ||
        (version === best.version && tag === releaseTag(version)))
    ) {
      best = { tag, version };
    }
  }
  return best?.tag ?? null;
}
