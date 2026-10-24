import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';

// Neither relay runs inside the workspace: the hosted one deploys from a
// folder of its own, and the self-hosted one is a single file run with plain
// node. Both are built into relay/dist, which git ignores.
const relayDir = path.resolve(import.meta.dirname);
const outDir = path.join(relayDir, 'dist');
const vercelSource = path.join(relayDir, 'vercel');
const vercelOut = path.join(outDir, 'vercel');

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
        output: { format: 'es', entryFileNames: path.basename(target.file) },
      },
    },
    ssr: { noExternal: true, target: 'node' },
  });
}

// A relay never merges documents, so Automerge and its wasm must not end up
// in a bundle; a dependency that pulled it in would show up here.
async function check(target: Target): Promise<void> {
  const code = await readFile(target.file, 'utf8');
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
