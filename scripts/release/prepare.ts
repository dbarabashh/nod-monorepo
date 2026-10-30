import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { releaseChangelog } from './changelog.ts';
import { isNewer } from './version.ts';

const run = promisify(execFile);

export function versionIn(manifest: string): string {
  const parsed: unknown = JSON.parse(manifest);
  const version: unknown =
    typeof parsed === 'object' && parsed !== null
      ? Reflect.get(parsed, 'version')
      : undefined;
  if (typeof version !== 'string') {
    throw new Error('package.json has no version');
  }
  return version;
}

export type ReleaseOptions = {
  appDir: string;
  version: string | undefined;
  isReleaseVersion: (version: string) => boolean;
  usage: string;
  tag: (version: string) => string;
  commitMessage: string;
  tagMessage: string;
};

// Bumps the app's package.json, moves the Unreleased changes under the
// version, and makes a signed commit and tag. It pushes nothing.
export async function prepareRelease(options: ReleaseOptions): Promise<void> {
  const { appDir, version } = options;
  const manifestPath = path.join(appDir, 'package.json');
  const changelogPath = path.join(appDir, 'CHANGELOG.md');
  const git = async (...args: string[]) => {
    const { stdout } = await run('git', args, { cwd: appDir });
    return stdout.trim();
  };
  if (version === undefined || !options.isReleaseVersion(version)) {
    throw new Error(options.usage);
  }
  const manifest = await readFile(manifestPath, 'utf8');
  const current = versionIn(manifest);
  if (!isNewer(version, current)) {
    throw new Error(`${version} is not newer than ${current}.`);
  }
  if ((await git('branch', '--show-current')) !== 'main') {
    throw new Error('Release from main.');
  }
  if ((await git('status', '--porcelain')) !== '') {
    throw new Error('Commit or stash your changes first.');
  }
  await git('fetch', '--quiet', 'origin', 'main');
  if (
    (await git('rev-parse', 'HEAD')) !== (await git('rev-parse', 'origin/main'))
  ) {
    throw new Error('main differs from origin/main; pull or push first.');
  }
  const tag = options.tag(version);
  if ((await git('tag', '--list', tag)) !== '') {
    throw new Error(`Tag ${tag} already exists.`);
  }

  const changelog = releaseChangelog(
    await readFile(changelogPath, 'utf8'),
    version,
    new Date().toISOString().slice(0, 10),
  );
  try {
    await writeFile(changelogPath, changelog);
    await writeFile(
      manifestPath,
      manifest.replace(`"version": "${current}"`, `"version": "${version}"`),
    );
    if (versionIn(await readFile(manifestPath, 'utf8')) !== version) {
      throw new Error('Could not set the version in package.json.');
    }
    await git('add', manifestPath, changelogPath);
    await git('commit', '--gpg-sign', '--message', options.commitMessage);
  } catch (error) {
    await git('restore', '--staged', '--worktree', manifestPath, changelogPath);
    throw error;
  }
  await git('verify-commit', 'HEAD');
  await git('tag', '--sign', tag, '--message', options.tagMessage);
  await git('verify-tag', tag);

  console.log(
    `Tagged ${tag}. Check it, then push it to start the release:\n\n  git push --atomic origin main ${tag}\n`,
  );
}
