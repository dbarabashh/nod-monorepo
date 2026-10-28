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

async function prepare(version: string | undefined) {
  if (version === undefined || !isVersion(version) || isPrerelease(version)) {
    throw new Error('Usage: pnpm release <major.minor.patch>, e.g. 1.2.0');
  }
  const manifest = await readFile(manifestPath, 'utf8');
  const current = currentVersion(manifest);
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
  const tag = releaseTag(version);
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
    throw error;
  }
  await git('verify-commit', 'HEAD');
  await git('tag', '--sign', tag, '--message', `Nod ${version}`);
  await git('verify-tag', tag);

  console.log(
    `Tagged ${tag}. Check it, then push it to start the release:\n\n  git push --atomic origin main ${tag}\n`,
  );
}

prepare(process.argv[2]).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
