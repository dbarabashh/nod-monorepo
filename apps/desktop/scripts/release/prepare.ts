import path from 'node:path';
import { runRelease } from '../../../../scripts/release/prepare.ts';
import {
  isPrerelease,
  isVersion,
} from '../../../../scripts/release/version.ts';
import { releaseTag } from '../../src/main/updates/feed.ts';

runRelease(
  {
    appDir: path.resolve(import.meta.dirname, '../..'),
    app: 'desktop',
    filter: 'nod-desktop',
    versionRule: 'major.minor.patch',
    isReleaseVersion: (candidate) =>
      isVersion(candidate) && !isPrerelease(candidate),
    tag: releaseTag,
    tagMessage: (version) => `Nod ${version}`,
  },
  process.argv.slice(2),
);
