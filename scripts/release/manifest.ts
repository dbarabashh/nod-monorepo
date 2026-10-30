export type ReleaseFile = { size: number; sha256: string };

export const manifestFile = 'latest.json';
export const signatureFile = 'latest.json.sig';

const byName = ([a]: [string, unknown], [b]: [string, unknown]) =>
  a < b ? -1 : a > b ? 1 : 0;

// The manifest is what installed copies trust: the release key signs it,
// and it names the size and SHA-256 of every file in the release.
export function releaseManifest(
  version: string,
  tag: string,
  files: Map<string, ReleaseFile>,
): string {
  return `${JSON.stringify(
    {
      version,
      tag,
      files: Object.fromEntries([...files].toSorted(byName)),
    },
    null,
    2,
  )}\n`;
}

export function checksums(hashes: Map<string, string>): string {
  return [...hashes]
    .toSorted(byName)
    .map(([file, hash]) => `${hash}  ${file}\n`)
    .join('');
}
