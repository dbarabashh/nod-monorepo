import path from 'node:path';
import { prepareRelease } from '../../../../scripts/release/prepare.ts';
import {
  isPrerelease,
  isVersion,
} from '../../../../scripts/release/version.ts';
import { releaseTag } from '../../src/main/updates/feed.ts';

const version = process.argv[2];

prepareRelease({
  appDir: path.resolve(import.meta.dirname, '../..'),
  version,
  isReleaseVersion: (candidate) =>
    isVersion(candidate) && !isPrerelease(candidate),
  usage: 'Usage: pnpm release <major.minor.patch>, e.g. 1.2.0',
  tag: releaseTag,
  commitMessage: `release desktop ${version}`,
  tagMessage: `Nod ${version}`,
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
