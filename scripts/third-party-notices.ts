import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  buildNotices,
  renderNotices,
  type Component,
} from './notices/notices.ts';

const run = promisify(execFile);

// pnpm is a .cmd shim on Windows, which execFile can't start without a shell.
// Under a pnpm script, pnpm names its own entry point instead: a script that
// plain node runs, or (for the standalone build) an executable.
function pnpm(
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
) {
  const entry = process.env.npm_execpath;
  const own = entry !== undefined && /pnpm/i.test(entry) ? entry : undefined;
  const settings = { ...options, maxBuffer: 64 * 1024 * 1024 };
  if (own !== undefined && /\.[cm]?js$/.test(own)) {
    return run(process.execPath, [own, ...args], settings);
  }
  if (own !== undefined) return run(own, args, settings);
  return run('pnpm', args, {
    ...settings,
    shell: process.platform === 'win32',
  });
}

const root = path.resolve(import.meta.dirname, '..');
const vendored = path.join(import.meta.dirname, 'notices');

const licenseFile = /^(?:licen[cs]e|copying|notice)(?:[-._].*)?$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

// Some packages name a license in their metadata but ship no file. The
// license's standard text then goes in, under the authors the metadata
// names, so the notice the license asks for is still there.
async function standardText(
  license: string,
  authors: string[],
): Promise<string | null> {
  const ids = license.replace(/[()]/g, ' ').split(/\s+/);
  const file = ids.includes('MIT')
    ? path.join(vendored, 'MIT.template')
    : ids.includes('Apache-2.0')
      ? path.join(root, 'LICENSE')
      : null;
  if (file === null) return null;
  const by =
    authors.length > 0 ? `Copyright (c) ${authors.join(', ')}\n\n` : '';
  return `${by}${(await readFile(file, 'utf8')).trim()}`;
}

function authorsOf(manifest: Record<string, unknown>): string[] {
  const author = manifest.author;
  if (typeof author === 'string') return [author.replace(/\s*[<(].*$/, '')];
  if (isRecord(author) && typeof author.name === 'string') return [author.name];
  return strings(manifest.authors).map((name) => name.replace(/\s*<.*$/, ''));
}

async function packageText(
  directory: string,
  license: string,
): Promise<string[]> {
  const found = await licenseText(directory);
  if (found.length > 0) return found;
  const manifest: unknown = JSON.parse(
    await readFile(path.join(directory, 'package.json'), 'utf8'),
  );
  const standard = await standardText(
    license,
    isRecord(manifest) ? authorsOf(manifest) : [],
  );
  return standard === null ? [] : [standard];
}

async function licenseText(directory: string): Promise<string[]> {
  const names = (await readdir(directory))
    .filter((name) => licenseFile.test(name))
    .sort();
  const texts = await Promise.all(
    names.map((name) => readFile(path.join(directory, name), 'utf8')),
  );
  return texts.map((text) => text.trim());
}

// The workspace installs a hoisted node_modules, so the store paths pnpm
// reports don't exist. Packages are found by name and version instead,
// including copies nested under another package for a version conflict.
async function installedPackages(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const visit = async (modules: string): Promise<void> => {
    let names: string[];
    try {
      names = await readdir(modules);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const scoped = name.startsWith('@');
      const directories = scoped
        ? (await readdir(path.join(modules, name)).catch(() => [])).map(
            (inner) => path.join(modules, name, inner),
          )
        : [path.join(modules, name)];
      for (const directory of directories) {
        try {
          const manifest: unknown = JSON.parse(
            await readFile(path.join(directory, 'package.json'), 'utf8'),
          );
          if (
            isRecord(manifest) &&
            typeof manifest.name === 'string' &&
            typeof manifest.version === 'string'
          ) {
            const key = `${manifest.name}@${manifest.version}`;
            if (!found.has(key)) found.set(key, directory);
          }
        } catch {
          continue;
        }
        await visit(path.join(directory, 'node_modules'));
      }
    }
  };
  await visit(path.join(root, 'node_modules'));
  return found;
}

// What pnpm resolves for the app's production dependencies. Workspace
// packages are this repository's own code and carry its license.
async function npmComponents(filter: string): Promise<Component[]> {
  const { stdout } = await pnpm(
    ['--filter', filter, 'licenses', 'list', '--prod', '--json'],
    { cwd: root },
  );
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed))
    throw new Error('pnpm licenses returned an unexpected shape');
  const installed = await installedPackages();
  const components: Component[] = [];
  for (const [license, packages] of Object.entries(parsed)) {
    if (!Array.isArray(packages)) continue;
    for (const item of packages) {
      if (
        !isRecord(item) ||
        typeof item.name !== 'string' ||
        item.name.startsWith('@nod/')
      )
        continue;
      for (const version of strings(item.versions)) {
        const directory = installed.get(`${item.name}@${version}`);
        components.push({
          name: item.name,
          version,
          license,
          source: 'npm',
          texts:
            directory === undefined
              ? []
              : await packageText(directory, license),
        });
      }
    }
  }
  return components;
}

// Only crates linked into the library for the given targets: dev and build
// dependencies, procedural macros, and crates for other platforms never ship.
async function crateComponents(
  crate: string,
  targets: string[],
): Promise<Component[]> {
  const found = new Map<string, Component>();
  for (const target of targets) {
    const { stdout } = await run(
      'cargo',
      [
        'metadata',
        '--format-version',
        '1',
        '--locked',
        '--filter-platform',
        target,
      ],
      { cwd: crate, maxBuffer: 64 * 1024 * 1024 },
    );
    const metadata: unknown = JSON.parse(stdout);
    if (
      !isRecord(metadata) ||
      !isRecord(metadata.resolve) ||
      !Array.isArray(metadata.packages)
    ) {
      throw new Error('cargo metadata returned an unexpected shape');
    }
    const packages = new Map<string, Record<string, unknown>>();
    for (const item of metadata.packages) {
      if (isRecord(item) && typeof item.id === 'string')
        packages.set(item.id, item);
    }
    const nodes = new Map<string, unknown[]>();
    for (const node of Array.isArray(metadata.resolve.nodes)
      ? metadata.resolve.nodes
      : []) {
      if (isRecord(node) && typeof node.id === 'string')
        nodes.set(node.id, Array.isArray(node.deps) ? node.deps : []);
    }
    const stack =
      typeof metadata.resolve.root === 'string' ? [metadata.resolve.root] : [];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined || seen.has(id)) continue;
      const item = packages.get(id);
      const targets = item && Array.isArray(item.targets) ? item.targets : [];
      const kinds = targets.flatMap((target) =>
        isRecord(target) ? strings(target.kind) : [],
      );
      // A procedural macro runs in the compiler; neither it nor what it
      // depends on ends up in the library.
      if (kinds.includes('proc-macro')) continue;
      seen.add(id);
      for (const dep of nodes.get(id) ?? []) {
        if (
          !isRecord(dep) ||
          typeof dep.pkg !== 'string' ||
          !Array.isArray(dep.dep_kinds)
        )
          continue;
        if (dep.dep_kinds.some((kind) => isRecord(kind) && kind.kind === null))
          stack.push(dep.pkg);
      }
    }
    for (const id of seen) {
      const item = packages.get(id);
      if (
        !item ||
        item.source === null ||
        typeof item.name !== 'string' ||
        typeof item.version !== 'string'
      )
        continue;
      const key = `${item.name}@${item.version}`;
      if (found.has(key) || typeof item.manifest_path !== 'string') continue;
      found.set(key, {
        name: item.name,
        version: item.version,
        license:
          typeof item.license === 'string' ? item.license : 'see license file',
        source: 'crate',
        texts: await crateTexts(
          path.dirname(item.manifest_path),
          item.license,
          authorsOf(item),
        ),
      });
    }
  }
  return [...found.values()];
}

async function crateTexts(
  directory: string,
  license: unknown,
  authors: string[],
): Promise<string[]> {
  const found = await licenseText(directory);
  if (found.length > 0 || typeof license !== 'string') return found;
  const standard = await standardText(license, authors);
  return standard === null ? [] : [standard];
}

async function bundled(
  name: string,
  version: string,
  license: string,
  file: string,
): Promise<Component> {
  return {
    name,
    version,
    license,
    source: 'bundled',
    texts: [(await readFile(file, 'utf8')).trim()],
  };
}

function unique(components: Component[]): Component[] {
  const seen = new Map<string, Component>();
  for (const component of components) {
    const key = `${component.name}@${component.version}`;
    if (!seen.has(key)) seen.set(key, component);
  }
  return [...seen.values()];
}

// pnpm doesn't follow workspace packages, so @nod/core's own dependencies,
// which ship inside both apps, are collected separately.
async function desktopComponents(): Promise<Component[]> {
  return unique([
    ...(await npmComponents('nod-desktop')),
    ...(await npmComponents('@nod/core')),
    await bundled(
      'Electron',
      'bundled',
      'MIT',
      path.join(root, 'node_modules/electron/LICENSE'),
    ),
    await bundled(
      'llama.cpp (in @fugood/llama.node)',
      'bundled',
      'MIT',
      path.join(vendored, 'llama.cpp.LICENSE'),
    ),
    await bundled(
      'whisper.cpp (in @fugood/whisper.node)',
      'bundled',
      'MIT',
      path.join(vendored, 'whisper.cpp.LICENSE'),
    ),
    await bundled(
      'Inter typeface',
      '4',
      'OFL-1.1',
      path.join(
        root,
        'apps/desktop/src/renderer/assets/fonts/inter/LICENSE.txt',
      ),
    ),
  ]);
}

// pnpm counts Expo's build tooling as production dependencies, so the list
// is cut to what ships: every package the JavaScript bundle includes, and the
// app's direct dependencies, whose native code is linked even when no
// JavaScript imports them.
async function mobileShippedPackages(): Promise<Set<string>> {
  const app = path.join(root, 'apps/mobile');
  const output = await mkdtemp(path.join(tmpdir(), 'nod-notices-'));
  try {
    await pnpm(
      [
        'exec',
        'expo',
        'export',
        '--platform',
        'ios',
        '--source-maps',
        '--output-dir',
        output,
      ],
      { cwd: app, env: { ...process.env, EXPO_NO_TELEMETRY: '1' } },
    );
    const bundles = path.join(output, '_expo/static/js/ios');
    const map = (await readdir(bundles)).find((name) => name.endsWith('.map'));
    if (map === undefined) throw new Error('expo export wrote no source map');
    const parsed: unknown = JSON.parse(
      await readFile(path.join(bundles, map), 'utf8'),
    );
    const shipped = new Set<string>();
    for (const source of isRecord(parsed) ? strings(parsed.sources) : []) {
      const at = source.lastIndexOf('node_modules/');
      if (at < 0) continue;
      const [scope = '', name = ''] = source
        .slice(at + 'node_modules/'.length)
        .split('/');
      shipped.add(scope.startsWith('@') ? `${scope}/${name}` : scope);
    }
    const manifest: unknown = JSON.parse(
      await readFile(path.join(app, 'package.json'), 'utf8'),
    );
    if (isRecord(manifest) && isRecord(manifest.dependencies)) {
      for (const name of Object.keys(manifest.dependencies)) shipped.add(name);
    }
    return shipped;
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// CocoaPods writes every native iOS library's license into an
// acknowledgements file for each target during pod install, including code
// with no npm package of its own, such as Hermes.
async function podComponents(): Promise<Component[]> {
  const supportFiles = path.join(
    root,
    'apps/mobile/ios/Pods/Target Support Files',
  );
  let targets: string[];
  try {
    targets = await readdir(supportFiles);
  } catch {
    throw new Error(
      'apps/mobile/ios/Pods is missing: run `pnpm ios` (or `expo prebuild` and `pod install`) once, so the iOS libraries can be listed',
    );
  }
  const found = new Map<string, Component>();
  for (const target of targets.filter((name) => name.startsWith('Pods-'))) {
    const plist = await readFile(
      path.join(supportFiles, target, `${target}-acknowledgements.plist`),
      'utf8',
    ).catch(() => '');
    for (const entry of plist.matchAll(/<dict>([\s\S]*?)<\/dict>/g)) {
      const field = (key: string) =>
        new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`).exec(
          entry[1] ?? '',
        )?.[1];
      const title = field('Title');
      const text = field('FooterText');
      // The first entry is the file's own heading, not a library.
      if (!title || !text || title === 'Acknowledgements' || found.has(title))
        continue;
      found.set(title, {
        name: unescapeXml(title),
        version: 'pod',
        license: unescapeXml(field('License') ?? 'see license text'),
        source: 'pod',
        texts: [unescapeXml(text).trim()],
      });
    }
  }
  return [...found.values()];
}

// Gradle resolves the Android libraries at build time, so they can't be read
// from the workspace. These are the ones the app's own modules add; React
// Native and Expo bring further AndroidX and Kotlin libraries, all under
// Apache-2.0. Google's ML Kit and Play services scanners are kept out of the
// build (plugins/with-no-google-scanners.js), so they aren't listed.
async function androidComponents(): Promise<Component[]> {
  const apache = (await readFile(path.join(root, 'LICENSE'), 'utf8')).trim();
  return [
    {
      name: 'AndroidX, CameraX and Kotlin libraries (androidx.*, org.jetbrains.kotlin)',
      version: 'android',
      license: 'Apache-2.0',
      source: 'android',
      texts: [
        `Copyright The Android Open Source Project\nCopyright JetBrains s.r.o. and Kotlin Programming Language contributors\n\n${apache}`,
      ],
    },
    {
      name: 'ZXing core (com.google.zxing:core, in modules/qr-scanner)',
      version: '3.5.3',
      license: 'Apache-2.0',
      source: 'android',
      texts: [`Copyright ZXing authors\n\n${apache}`],
    },
  ];
}

async function mobileComponents(): Promise<Component[]> {
  const shipped = await mobileShippedPackages();
  const crates = await crateComponents(
    path.join(root, 'packages/automerge-native/rust'),
    [
      'aarch64-apple-ios',
      'aarch64-linux-android',
      'armv7-linux-androideabi',
      'x86_64-linux-android',
    ],
  );
  // The automerge crate ships no license file; it is the same project, and
  // license, as the @automerge/automerge package, which does.
  const automergeLicense = (
    await readFile(
      path.join(root, 'node_modules/@automerge/automerge/LICENSE'),
      'utf8',
    )
  ).trim();
  return unique([
    ...(await npmComponents('nod-mobile')).filter((component) =>
      shipped.has(component.name),
    ),
    ...(await npmComponents('@nod/core')),
    ...crates.map((component) =>
      component.name === 'automerge'
        ? { ...component, texts: [automergeLicense] }
        : component,
    ),
    await bundled(
      'whisper.cpp (in whisper.rn)',
      'bundled',
      'MIT',
      path.join(vendored, 'whisper.cpp.LICENSE'),
    ),
    ...(await podComponents()),
    ...(await androidComponents()),
  ]);
}

const title = `Nod includes the third-party software listed below, each under its own license.
Nod's own code is licensed under the Apache License 2.0. Speech and summary
models are not included: each is downloaded from its publisher under its own
license, named on the model's screen in the app.`;

const [app, output] = process.argv.slice(2);
if ((app !== 'desktop' && app !== 'mobile') || output === undefined) {
  throw new Error(
    'usage: node scripts/third-party-notices.ts <desktop|mobile> <output file>',
  );
}
const notices = buildNotices(
  app === 'desktop' ? await desktopComponents() : await mobileComponents(),
);
const contents = output.endsWith('.json')
  ? JSON.stringify({ title, ...notices }, null, 2) + '\n'
  : renderNotices(notices, title);
await writeFile(output, contents);
console.log(
  `wrote ${notices.entries.length} components, ${Object.keys(notices.texts).length} license texts to ${output}`,
);
