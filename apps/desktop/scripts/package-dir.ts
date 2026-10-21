import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function workspaceRoot(start: string): string {
  let dir = start;
  while (!existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      return start;
    }
    dir = parent;
  }
  return dir;
}

// The workspace hoists packages to the repository root, so a package is found
// along Node's lookup path instead of in this app's own node_modules. The
// search stops at the workspace root: a stray copy in a parent folder or the
// home directory must never end up in a build.
export function packageDir(name: string, from: string): string | undefined {
  const fromPath = from.startsWith('file:') ? fileURLToPath(from) : from;
  const root = workspaceRoot(path.dirname(fromPath));
  for (const dir of createRequire(fromPath).resolve.paths(name) ?? []) {
    const fromRoot = path.relative(root, dir);
    if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
      continue;
    }
    const candidate = path.join(dir, name);
    if (existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
  }
  return undefined;
}

export function requirePackageDir(name: string, from: string): string {
  const dir = packageDir(name, from);
  if (dir === undefined) {
    throw new Error(`${name} is not installed`);
  }
  return dir;
}
