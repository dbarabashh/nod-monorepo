import { macFeedFile } from '../../src/main/updates/feed.ts';

export const macArchs = ['arm64', 'x64'];

function macZip(productName: string, arch: string, version: string): string {
  return `${productName}-darwin-${arch}-${version}.zip`;
}

// One installer per platform and architecture the release workflow builds,
// and nothing else: a file missing leaves those users without the update, and
// a stray one would be signed into the manifest every copy trusts.
export function releaseAssets(
  productName: string,
  packageName: string,
  version: string,
): string[] {
  return [
    ...macArchs.flatMap((arch) => [
      macZip(productName, arch, version),
      `${productName}-${version}-${arch}.dmg`,
    ]),
    `${productName}.ico`,
    'RELEASES',
    `${packageName.replaceAll('-', '_')}-${version}-full.nupkg`,
    `${productName}-${version}-Setup.exe`,
    `${packageName}_${version}_amd64.deb`,
    `${packageName}_${version}_arm64.deb`,
    `${packageName}-${version}-1.x86_64.rpm`,
    `${packageName}-${version}-1.arm64.rpm`,
  ];
}

export function compareAssets(
  files: string[],
  expected: string[],
): { missing: string[]; unexpected: string[] } {
  return {
    missing: expected.filter((name) => !files.includes(name)),
    unexpected: files.filter((name) => !expected.includes(name)),
  };
}

type FeedOptions = {
  base: string;
  tag: string;
  productName: string;
  version: string;
  notes: string;
  publishedAt: string;
};

// Squirrel.Mac reads the RELEASES-darwin-<arch>.json "static file" format and
// downloads the ZIP it names from the release the feed belongs to.
export function macFeeds(options: FeedOptions): Map<string, string> {
  const { base, tag, productName, version, notes, publishedAt } = options;
  const feeds = new Map<string, string>();
  for (const arch of macArchs) {
    const update = {
      version,
      name: `${productName} ${version}`,
      notes,
      pub_date: publishedAt,
      url: `${base}/download/${tag}/${macZip(productName, arch, version)}`,
    };
    feeds.set(
      macFeedFile(arch),
      `${JSON.stringify(
        {
          currentRelease: version,
          releases: [{ version, updateTo: update }],
        },
        null,
        2,
      )}\n`,
    );
  }
  return feeds;
}
