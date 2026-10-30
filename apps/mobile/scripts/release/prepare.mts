import path from 'node:path';
import { runRelease } from '../../../../scripts/release/prepare.ts';
import { isReleaseVersion, releaseTag } from './version.mts';

runRelease(
  {
    appDir: path.resolve(import.meta.dirname, '../..'),
    app: 'mobile',
    filter: 'nod-mobile',
    versionRule: 'major.minor.patch, each part below 1000',
    isReleaseVersion,
    tag: releaseTag,
    tagMessage: (version) => `Nod ${version} for phones`,
  },
  process.argv.slice(2),
);
