import path from 'node:path';
import { prepareRelease } from '../../../../scripts/release/prepare.ts';
import { isReleaseVersion, releaseTag } from './version.mts';

const version = process.argv[2];

prepareRelease({
  appDir: path.resolve(import.meta.dirname, '../..'),
  version,
  isReleaseVersion,
  usage:
    'Usage: pnpm release <major.minor.patch>, each part below 1000, e.g. 1.2.0',
  tag: releaseTag,
  commitMessage: `release mobile ${version}`,
  tagMessage: `Nod ${version} for phones`,
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
