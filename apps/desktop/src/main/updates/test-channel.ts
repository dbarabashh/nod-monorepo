import { isNewer, isPrerelease, isVersion } from '@nod/core/updates';
import { releaseTag, releaseTagPrefix, testReleaseTagPrefix } from './feed.ts';

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
