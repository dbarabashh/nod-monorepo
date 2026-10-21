import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// The NDK React Native builds with, so both halves of the app share it.
function reactNativeNdk(): string | undefined {
  try {
    const toml = readFileSync(
      path.join(
        createRequire(import.meta.url).resolve('react-native/package.json'),
        '..',
        'gradle',
        'libs.versions.toml',
      ),
      'utf8',
    );
    return /^ndkVersion\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  } catch {
    return undefined;
  }
}

function ndkRoot(): string {
  const fromEnv = process.env.ANDROID_NDK_HOME;
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk) {
    throw new Error(
      'Set ANDROID_HOME to the Android SDK to build the Automerge library',
    );
  }
  const ndkDir = path.join(sdk, 'ndk');
  const wanted = reactNativeNdk();
  const installed = existsSync(ndkDir) ? readdirSync(ndkDir) : [];
  const chosen =
    wanted && installed.includes(wanted)
      ? wanted
      : installed
          .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
          .at(-1);
  if (!chosen) {
    throw new Error(
      `No NDK in ${ndkDir}. Install the NDK React Native uses (${wanted ?? 'see its gradle/libs.versions.toml'}) with the SDK manager.`,
    );
  }
  return path.join(ndkDir, chosen);
}

const hostTags: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'darwin-x86_64',
  win32: 'windows-x86_64',
};
const hostTag = hostTags[process.platform] ?? 'linux-x86_64';

/** The NDK's clang and llvm-ar for the host this runs on. */
export function ndkTools(): { bin: string; exe: string; cmd: string } {
  const windows = process.platform === 'win32';
  return {
    bin: path.join(ndkRoot(), 'toolchains', 'llvm', 'prebuilt', hostTag, 'bin'),
    exe: windows ? '.exe' : '',
    cmd: windows ? '.cmd' : '',
  };
}
