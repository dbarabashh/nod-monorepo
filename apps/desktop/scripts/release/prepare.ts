import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { releaseTag } from '../../src/main/updates/feed.ts';
import {
  isNewer,
  isPrerelease,
  isVersion,
} from '../../src/main/updates/version.ts';
import { releaseChangelog } from './changelog.ts';

const run = promisify(execFile);
const appDir = path.resolve(import.meta.dirname, '../..');
const manifestPath = path.join(appDir, 'package.json');
const changelogPath = path.join(appDir, 'CHANGELOG.md');

async function git(...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd: appDir });
  return stdout.trim();
}

function currentVersion(manifest: string): string {
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

function releaseVersion(version: string | undefined, usage: string): string {
  if (version === undefined || !isVersion(version) || isPrerelease(version)) {
    throw new Error(`Usage: ${usage} <major.minor.patch>, e.g. 1.2.0`);
  }
  return version;
}

async function onMainAsPushed() {
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

async function tagExists(tag: string): Promise<boolean> {
  return (
    (await git('tag', '--list', tag)) !== '' ||
    (await git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)) !== ''
  );
}

// main takes changes only through pull requests, so the version and the
// release notes go to a branch of their own; the tag follows the merge.
async function prepare(input: string | undefined) {
  const version = releaseVersion(input, 'pnpm release');
  const manifest = await readFile(manifestPath, 'utf8');
  const current = currentVersion(manifest);
  if (!isNewer(version, current)) {
    throw new Error(`${version} is not newer than ${current}.`);
  }
  await onMainAsPushed();
  const tag = releaseTag(version);
  if (await tagExists(tag)) {
    throw new Error(`Tag ${tag} already exists.`);
  }
  const branch = `release/desktop-${version}`;
  if ((await git('branch', '--list', branch)) !== '') {
    throw new Error(`Branch ${branch} already exists.`);
  }
  await git('switch', '--create', branch);

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
    if (currentVersion(await readFile(manifestPath, 'utf8')) !== version) {
      throw new Error('Could not set the version in package.json.');
    }
    await git('add', manifestPath, changelogPath);
    await git(
      'commit',
      '--gpg-sign',
      '--message',
      `release desktop ${version}`,
    );
  } catch (error) {
    await git('restore', '--staged', '--worktree', manifestPath, changelogPath);
    await git('switch', 'main');
    await git('branch', '--delete', branch);
    throw error;
  }
  await git('verify-commit', 'HEAD');

  console.log(
    `Committed release desktop ${version} on ${branch}. Push it and open a pull request:\n\n  git push --set-upstream origin ${branch}\n  gh pr create --base main --title "Release desktop ${version}"\n\nOnce it is merged, tag the merge on main:\n\n  pnpm --filter nod-desktop release:tag ${version}\n`,
  );
}

// The merged release commit gets the signed tag that starts the workflow.
async function tagRelease(input: string | undefined) {
  const version = releaseVersion(input, 'pnpm release:tag');
  await onMainAsPushed();
  const current = currentVersion(await readFile(manifestPath, 'utf8'));
  if (current !== version) {
    throw new Error(
      `main is at ${current}; merge the release pull request for ${version} first.`,
    );
  }
  const tag = releaseTag(version);
  if (await tagExists(tag)) {
    throw new Error(`Tag ${tag} already exists.`);
  }
  await git('tag', '--sign', tag, '--message', `Nod ${version}`);
  await git('verify-tag', tag);
  console.log(
    `Tagged ${tag}. Check it, then push it to start the release:\n\n  git push origin ${tag}\n`,
  );
}

const [command, version] = process.argv.slice(2);
(command === 'tag' ? tagRelease(version) : prepare(command)).catch(
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
