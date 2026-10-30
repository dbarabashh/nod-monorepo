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
  // Names the app in the release branch and commit: desktop, mobile.
  app: string;
  // The pnpm package, for the commands the scripts print.
  filter: string;
  versionRule: string;
  isReleaseVersion: (version: string) => boolean;
  tag: (version: string) => string;
  tagMessage: (version: string) => string;
};

function gitIn(directory: string) {
  return async (...args: string[]) => {
    const { stdout } = await run('git', args, { cwd: directory });
    return stdout.trim();
  };
}

function checkedVersion(
  options: ReleaseOptions,
  version: string | undefined,
  command: string,
): string {
  if (version === undefined || !options.isReleaseVersion(version)) {
    throw new Error(
      `Usage: pnpm --filter ${options.filter} ${command} <${options.versionRule}>, e.g. 1.2.0`,
    );
  }
  return version;
}

async function onPushedMain(git: ReturnType<typeof gitIn>) {
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
    throw new Error('main differs from origin/main; pull first.');
  }
}

async function tagExists(git: ReturnType<typeof gitIn>, tag: string) {
  return (
    (await git('tag', '--list', tag)) !== '' ||
    (await git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)) !== ''
  );
}

// main takes changes only through pull requests, so the version and the
// release notes go to a branch of their own; the tag follows the merge.
async function prepareRelease(
  options: ReleaseOptions,
  input: string | undefined,
) {
  const version = checkedVersion(options, input, 'release');
  const git = gitIn(options.appDir);
  const manifestPath = path.join(options.appDir, 'package.json');
  const changelogPath = path.join(options.appDir, 'CHANGELOG.md');
  const manifest = await readFile(manifestPath, 'utf8');
  const current = versionIn(manifest);
  if (!isNewer(version, current)) {
    throw new Error(`${version} is not newer than ${current}.`);
  }
  await onPushedMain(git);
  const tag = options.tag(version);
  if (await tagExists(git, tag)) {
    throw new Error(`Tag ${tag} already exists.`);
  }
  const branch = `release/${options.app}-${version}`;
  if ((await git('branch', '--list', branch)) !== '') {
    throw new Error(`Branch ${branch} already exists.`);
  }

  const changelog = releaseChangelog(
    await readFile(changelogPath, 'utf8'),
    version,
    new Date().toISOString().slice(0, 10),
  );
  await git('switch', '--create', branch);
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
    await git(
      'commit',
      '--gpg-sign',
      '--message',
      `release ${options.app} ${version}`,
    );
  } catch (error) {
    await git('restore', '--staged', '--worktree', manifestPath, changelogPath);
    await git('switch', 'main');
    await git('branch', '--delete', branch);
    throw error;
  }
  await git('verify-commit', 'HEAD');

  console.log(
    `Committed release ${options.app} ${version} on ${branch}. Push it and open a pull request:\n\n  git push --set-upstream origin ${branch}\n  gh pr create --base main --title "Release ${options.app} ${version}"\n\nOnce it is merged, tag the merge on main:\n\n  pnpm --filter ${options.filter} release:tag ${version}\n`,
  );
}

// The merged release commit gets the signed tag that starts the workflow.
async function tagRelease(options: ReleaseOptions, input: string | undefined) {
  const version = checkedVersion(options, input, 'release:tag');
  const git = gitIn(options.appDir);
  await onPushedMain(git);
  const current = versionIn(
    await readFile(path.join(options.appDir, 'package.json'), 'utf8'),
  );
  if (current !== version) {
    throw new Error(
      `main is at ${current}; merge the release pull request for ${version} first.`,
    );
  }
  const tag = options.tag(version);
  if (await tagExists(git, tag)) {
    throw new Error(`Tag ${tag} already exists.`);
  }
  await git('tag', '--sign', tag, '--message', options.tagMessage(version));
  await git('verify-tag', tag);
  console.log(
    `Tagged ${tag}. Check it, then push it to start the release:\n\n  git push origin ${tag}\n`,
  );
}

// `release <version>` prepares the pull request, `tag <version>` tags its
// merge.
export function runRelease(options: ReleaseOptions, args: string[]): void {
  const [command, version] = args;
  (command === 'tag'
    ? tagRelease(options, version)
    : prepareRelease(options, command)
  ).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
