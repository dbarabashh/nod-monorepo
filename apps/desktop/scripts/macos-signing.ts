import path from 'node:path';

const buildDir = path.resolve(import.meta.dirname, '../build');

// Chromium's helpers need only what each process does: JIT for V8, plus what
// the plugin helper loads. The microphone is used by the app and the audio
// service in the plain helper. Everything else gets no entitlements, never
// the camera, location and devices osx-sign grants by default.
export function entitlementsFor(file: string): string {
  const name = path.basename(file);
  const plist =
    name.endsWith('.app') && !file.includes('.app/')
      ? 'entitlements.mac.plist'
      : name.endsWith('(Plugin).app')
        ? 'entitlements.plugin.plist'
        : name.endsWith('(GPU).app') || name.endsWith('(Renderer).app')
          ? 'entitlements.jit.plist'
          : name.endsWith(' Helper.app')
            ? 'entitlements.helper.plist'
            : 'entitlements.none.plist';
  return path.join(buildDir, plist);
}

// A bundle's main executable is signed with its bundle, which has to come
// after everything nested in it.
export function isBundleExecutable(file: string): boolean {
  return (
    /\.app\/Contents\/MacOS\/[^/]+$/.test(file) ||
    /\.framework\/Versions\/[^/]+\/[^/]+$/.test(file)
  );
}

export type SigningItem = { path: string; bundle: boolean };

// Inside out: deeper paths first, and at the same depth loose binaries before
// the bundles that sit beside them.
export function signingOrder(items: SigningItem[]): SigningItem[] {
  const depth = (item: SigningItem) => item.path.split('/').length;
  return items.toSorted(
    (a, b) => depth(b) - depth(a) || Number(a.bundle) - Number(b.bundle),
  );
}
