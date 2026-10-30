import {
  parseManifest as parseReleaseManifest,
  type ReleaseManifest,
} from '@nod/core/updates';
import { releaseTagPrefix, testReleaseTagPrefix } from './feed.ts';

export { releaseKeys, verifyManifest } from '@nod/core/updates';
export type { ReleaseFile } from '@nod/core/updates';

export type Manifest = ReleaseManifest;

export function parseManifest(raw: unknown): Manifest | null {
  return parseReleaseManifest(raw, [releaseTagPrefix, testReleaseTagPrefix]);
}
