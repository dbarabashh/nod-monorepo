// SPDX-FileCopyrightText: 2026 Dima Barabash
// SPDX-License-Identifier: AGPL-3.0-only

import {
  cp,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import {
  buildNotices,
  renderNotices,
  type Component,
} from '../../scripts/notices/notices.ts';

// Neither relay runs inside the workspace: the hosted one deploys from a
// folder of its own, and the self-hosted one is a single file run with plain
// node. Both are built into dist, which git ignores.
const relayDir = path.resolve(import.meta.dirname);
const outDir = path.join(relayDir, 'dist');
const vercelSource = path.join(relayDir, 'vercel');
const vercelOut = path.join(outDir, 'vercel');
const repoRoot = path.resolve(relayDir, '../..');

// Each bundle joins this folder's code (AGPL-3.0-only) with @nod/core
// (Apache-2.0). The combined file is licensed under the AGPL, and core's
// license and notice travel with it, as Apache-2.0 asks.
const banner = `// SPDX-License-Identifier: AGPL-3.0-only
// Nod sync relay, built from apps/relay (AGPL-3.0-only) together with
// code from packages/core (@nod/core, Apache-2.0). This file as a whole is
// licensed under AGPL-3.0-only; the code from @nod/core is also available
// under Apache-2.0. See LICENSE, LICENSE-Apache-2.0 and NOTICE beside it,
// and THIRD_PARTY_NOTICES for the third-party code bundled into it.`;

const licenseFiles = [
  { from: path.join(relayDir, 'LICENSE'), to: 'LICENSE' },
  { from: path.join(repoRoot, 'LICENSE'), to: 'LICENSE-Apache-2.0' },
];

// The repository's NOTICE describes the source tree; beside a bundle the files
// are named differently, so the bundle gets a notice of its own.
const notice = `Nod sync relay
Copyright 2026 Dima Barabash

This bundle is built from the Nod repository's apps/relay, licensed under the
GNU Affero General Public License, version 3 only (LICENSE), together with
code from its packages/core, licensed under the Apache License, Version 2.0
(LICENSE-Apache-2.0). The bundle as a whole is licensed under AGPL-3.0-only;
the code from packages/core remains available under Apache-2.0 on its own.
Third-party code bundled into it is listed with its licenses in
THIRD_PARTY_NOTICES.

If you run this relay for other people, set RELAY_SOURCE_URL to where its
source code is, so it can offer that source at /source.

The name "Nod" and the Nod logo are not licensed under any of these licenses.
`;

type Target = {
  entry: string;
  file: string;
  // What the bundle may still import where it runs.
  external: (specifier: string) => boolean;
};

const isBuiltin = (specifier: string) => specifier.startsWith('node:');

const targets: Target[] = [
  {
    entry: path.join(relayDir, 'server.ts'),
    file: path.join(outDir, 'server.js'),
    external: isBuiltin,
  },
  {
    entry: path.join(vercelSource, 'api', 'relay.ts'),
    file: path.join(vercelOut, 'api', 'relay.js'),
    // Installed from the folder's own lockfile when Vercel builds it.
    external: (specifier) =>
      isBuiltin(specifier) || specifier.startsWith('@vercel/blob'),
  },
];

async function bundle(target: Target): Promise<void> {
  await build({
    configFile: false,
    logLevel: 'warn',
    root: relayDir,
    build: {
      ssr: target.entry,
      outDir: path.dirname(target.file),
      emptyOutDir: false,
      copyPublicDir: false,
      minify: false,
      sourcemap: false,
      target: 'esnext',
      rolldownOptions: {
        external: target.external,
        output: {
          format: 'es',
          entryFileNames: path.basename(target.file),
          banner,
        },
      },
    },
    ssr: { noExternal: true, target: 'node' },
  });
}

// A relay never merges documents, so Automerge and its wasm must not end up
// in a bundle; a dependency that pulled it in would show up here.
async function check(target: Target): Promise<void> {
  const code = await readFile(target.file, 'utf8');
  if (!code.startsWith(banner)) {
    throw new Error(`${target.file} lost its license banner`);
  }
  if (/automerge|wasm/i.test(code)) {
    throw new Error(`${target.file} pulls in Automerge or wasm`);
  }
  for (const match of code.matchAll(
    /^(?:import|export)\b[^;'"]*?["']([^"']+)["']/gm,
  )) {
    const specifier = match[1] ?? '';
    if (!target.external(specifier)) {
      throw new Error(`${target.file} imports ${specifier} at run time`);
    }
  }
  const { size } = await stat(target.file);
  console.log(
    `${path.relative(relayDir, target.file)}: ${Math.round(size / 1024)} KB`,
  );
}

// The bundler marks where each module begins, with its path, so the
// third-party packages a bundle carries, and the copies it used, can be read
// off it for the notice that ships beside it.
async function bundledPackages(file: string): Promise<Component[]> {
  const code = await readFile(file, 'utf8');
  const directories = new Set<string>();
  for (const match of code.matchAll(/^\/\/#region (.+)$/gm)) {
    const source = match[1] ?? '';
    const at = source.lastIndexOf('node_modules/');
    if (at < 0) continue;
    const [scope = '', name = ''] = source
      .slice(at + 'node_modules/'.length)
      .split('/');
    const packageName = scope.startsWith('@') ? `${scope}/${name}` : scope;
    directories.add(
      path.resolve(relayDir, source.slice(0, at), 'node_modules', packageName),
    );
  }
  const components: Component[] = [];
  for (const directory of [...directories].sort()) {
    const manifest: unknown = JSON.parse(
      await readFile(path.join(directory, 'package.json'), 'utf8'),
    );
    const field = (key: string) =>
      typeof manifest === 'object' && manifest !== null
        ? Reflect.get(manifest, key)
        : undefined;
    const declared = field('name');
    const name =
      typeof declared === 'string' ? declared : path.basename(directory);
    const version = field('version');
    const license = field('license');
    const files = (await readdir(directory)).filter((entry) =>
      /^(?:licen[cs]e|notice)(?:[-._].*)?$/i.test(entry),
    );
    if (files.length === 0) {
      throw new Error(
        `${name} is bundled into the relay but ships no license file`,
      );
    }
    const texts = await Promise.all(
      files
        .sort()
        .map((entry) => readFile(path.join(directory, entry), 'utf8')),
    );
    components.push({
      name,
      version: typeof version === 'string' ? version : 'unknown',
      license: typeof license === 'string' ? license : 'see license file',
      source: 'npm',
      texts: texts.map((text) => text.trim()),
    });
  }
  return components;
}

// The deploy folder: the bundled function, its config pointing at the built
// file, and what Vercel installs. A `vercel link` made there survives a
// rebuild, since nothing in the folder is removed.
async function vercelFolder(): Promise<void> {
  for (const name of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
  ]) {
    await cp(path.join(vercelSource, name), path.join(vercelOut, name));
  }
  await cp(path.join(vercelSource, 'public'), path.join(vercelOut, 'public'), {
    recursive: true,
  });
  const config: unknown = JSON.parse(
    await readFile(path.join(vercelSource, 'vercel.json'), 'utf8'),
  );
  const functions =
    typeof config === 'object' && config !== null
      ? Reflect.get(config, 'functions')
      : null;
  const settings =
    typeof functions === 'object' && functions !== null
      ? Reflect.get(functions, 'api/relay.ts')
      : null;
  if (typeof config !== 'object' || config === null || !settings) {
    throw new Error('vercel.json names no api/relay.ts function');
  }
  await writeFile(
    path.join(vercelOut, 'vercel.json'),
    `${JSON.stringify({ ...config, functions: { 'api/relay.js': settings } }, null, 2)}\n`,
  );
}

await mkdir(path.join(vercelOut, 'api'), { recursive: true });
for (const target of targets) {
  await bundle(target);
  await check(target);
}
await vercelFolder();
const noticesTitle = `The Nod sync relay bundles the third-party software listed below, each under
its own license.`;
for (const target of targets) {
  const folder = target.file.startsWith(vercelOut) ? vercelOut : outDir;
  for (const { from, to } of licenseFiles) {
    await cp(from, path.join(folder, to));
  }
  await writeFile(path.join(folder, 'NOTICE'), notice);
  await writeFile(
    path.join(folder, 'THIRD_PARTY_NOTICES'),
    renderNotices(
      buildNotices(await bundledPackages(target.file)),
      noticesTitle,
    ),
  );
}
