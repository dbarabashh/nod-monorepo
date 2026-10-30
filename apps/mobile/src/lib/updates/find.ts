import {
  isNewer,
  manifestFile,
  mobileReleaseTagPrefix,
  newestRelease,
  parseManifest,
  signatureFile,
  verifyManifest,
  type Release,
} from '@nod/core/updates';

export type UpdateSource = { releases: string; publicKey: string };

export type Update = {
  version: string;
  tag: string;
  url: string;
  page: string;
  size: number;
  sha256: string;
};

type Page = { body: unknown; next: string | null };

export type Fetcher = {
  page: (url: string) => Promise<Page>;
  bytes: (url: string) => Promise<Uint8Array>;
  text: (url: string) => Promise<string>;
};

export function apkFile(version: string): string {
  return `Nod-${version}.apk`;
}

const githubReleases =
  /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/releases$/;

// The address follows a GitHub releases page; other hosts have no list to
// find the newest mobile release in, since GitHub's latest is the desktop's.
export function releasesApi(releases: string): string | null {
  const match = githubReleases.exec(releases);
  return match
    ? `https://api.github.com/repos/${match[1]}/${match[2]}/releases?per_page=100`
    : null;
}

const api = 'https://api.github.com/';

// GitHub pages its list with a Link header; only its own next page is followed.
export function nextPage(link: string | null): string | null {
  const next = link
    ?.split(',')
    .map((part) => /^\s*<([^>]+)>;\s*rel="next"\s*$/.exec(part)?.[1])
    .find((url) => url !== undefined);
  return next !== undefined && next.startsWith(api) ? next : null;
}

// Each desktop release adds two to the list, newest first; a few pages reach
// back past many desktop releases to the newest phone release.
const pagesToSearch = 3;

export async function findUpdate(
  source: UpdateSource,
  currentVersion: string,
  fetcher: Fetcher,
): Promise<Update | null> {
  let url = releasesApi(source.releases);
  if (url === null) {
    throw new Error('Updates come only from a GitHub releases page.');
  }
  let release: Release | null = null;
  for (let page = 0; page < pagesToSearch && url !== null; page += 1) {
    const { body, next } = await fetcher.page(url);
    release = newestRelease(body, mobileReleaseTagPrefix);
    if (release !== null) {
      break;
    }
    url = next;
  }
  if (release === null || !isNewer(release.version, currentVersion)) {
    return null;
  }
  const files = `${source.releases}/download/${release.tag}`;
  const [bytes, signature] = await Promise.all([
    fetcher.bytes(`${files}/${manifestFile}`),
    fetcher.text(`${files}/${signatureFile}`),
  ]);
  if (!verifyManifest(bytes, signature, source.publicKey)) {
    throw new Error(
      `The manifest of ${release.tag} isn't signed by Nod's release key.`,
    );
  }
  const manifest = parseManifest(JSON.parse(new TextDecoder().decode(bytes)), [
    mobileReleaseTagPrefix,
  ]);
  if (manifest === null || manifest.tag !== release.tag) {
    throw new Error(`The manifest of ${release.tag} names another release.`);
  }
  const name = apkFile(manifest.version);
  const apk = manifest.files.get(name);
  if (apk === undefined) {
    throw new Error(`${release.tag} has no ${name}.`);
  }
  return {
    version: manifest.version,
    tag: manifest.tag,
    url: `${files}/${name}`,
    page: `${source.releases}/tag/${manifest.tag}`,
    size: apk.size,
    sha256: apk.sha256,
  };
}
