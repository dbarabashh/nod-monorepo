export const releaseTagPrefix = 'desktop-v';
export const testReleaseTagPrefix = 'desktop-test-v';

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
