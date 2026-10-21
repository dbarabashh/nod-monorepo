import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

export const run = promisify(execFile);
export const root = path.resolve(import.meta.dirname, '..');
export const crate = path.join(root, 'rust');

function inherit(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: crate, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`)),
    );
  });
}

/** Builds the release library for every target in one cargo run, showing its progress. */
export async function cargoBuild(
  targets: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<void> {
  await run('rustup', ['target', 'add', ...targets], { cwd: crate });
  await inherit(
    'cargo',
    [
      'build',
      '--release',
      '--locked',
      ...targets.flatMap((t) => ['--target', t]),
    ],
    { ...process.env, ...env },
  );
}

export function builtLibrary(target: string, file: string): string {
  return path.join(crate, 'target', target, 'release', file);
}
