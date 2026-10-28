import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { packageDir, requirePackageDir } from './scripts/package-dir.ts';
import { entitlementsFor } from './scripts/macos-signing.ts';
import { updateBase } from './src/main/updates/feed.ts';
import { releaseKeys } from './src/main/updates/manifest.ts';

const run = promisify(execFile);

const signingIdentity = process.env.APPLE_SIGNING_IDENTITY;
const notaryProfile = process.env.APPLE_NOTARY_PROFILE;
const notaryApiKey = process.env.APPLE_API_KEY;
const notaryApiKeyId = process.env.APPLE_API_KEY_ID;
const notaryApiIssuer = process.env.APPLE_API_ISSUER;
const relayUrl = process.env.NOD_RELAY_URL;
const updateUrl = process.env.NOD_UPDATE_URL;
const updatePublicKey = process.env.NOD_UPDATE_PUBLIC_KEY;
const bundleId = process.env.NOD_BUNDLE_ID;
const releasesPage = updateUrl ? updateBase(updateUrl) : null;

type Notary =
  | { keychainProfile: string }
  | { appleApiKey: string; appleApiKeyId: string; appleApiIssuer: string };

// A keychain profile on a developer's Mac; an App Store Connect API key in CI,
// where there is no keychain to keep a profile in.
function notaryCredentials(): Notary | undefined {
  if (notaryProfile) {
    return { keychainProfile: notaryProfile };
  }
  if (notaryApiKey && notaryApiKeyId && notaryApiIssuer) {
    return {
      appleApiKey: notaryApiKey,
      appleApiKeyId: notaryApiKeyId,
      appleApiIssuer: notaryApiIssuer,
    };
  }
  return undefined;
}

const notary = notaryCredentials();

function notarytoolCredentials(credentials: Notary): string[] {
  return 'keychainProfile' in credentials
    ? ['--keychain-profile', credentials.keychainProfile]
    : [
        '--key',
        credentials.appleApiKey,
        '--key-id',
        credentials.appleApiKeyId,
        '--issuer',
        credentials.appleApiIssuer,
      ];
}

// The relay a build offers is baked in by Vite from NOD_RELAY_URL, so a
// release must choose it on purpose: an address, or empty for no relay. An
// address the app would refuse fails the build instead of quietly vanishing.
function checkRelayUrl() {
  if (relayUrl === undefined) {
    if (signingIdentity) {
      throw new Error(
        'Set NOD_RELAY_URL for a release: the relay address, or empty for a build without one.',
      );
    }
    console.warn(
      'NOD_RELAY_URL is not set, so this build offers no relay; sync works only through a folder or a relay address the user types.',
    );
    return;
  }
  if (relayUrl === '') {
    return;
  }
  const url = URL.parse(relayUrl);
  if (
    url?.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'NOD_RELAY_URL must be an https:// address without a login, query or #part',
    );
  }
}

// Installed copies update from the feed at this address, so a release names
// it on purpose, or leaves it empty for a build that never updates itself.
function checkUpdateUrl() {
  if (updateUrl === undefined) {
    if (signingIdentity) {
      throw new Error(
        'Set NOD_UPDATE_URL for a release: the releases page installed copies update from, or empty for a build that doesn’t update itself.',
      );
    }
    return;
  }
  if (updateUrl !== '' && releasesPage === null) {
    throw new Error(
      'NOD_UPDATE_URL must be an https:// address without a login, query or #part',
    );
  }
  if (updateUrl !== '' && releaseKeys(updatePublicKey ?? '') === null) {
    throw new Error(
      'Set NOD_UPDATE_PUBLIC_KEY to the release key (pnpm release:key): installed copies install only releases it signed.',
    );
  }
}

// macOS ties keychain items, permissions and Squirrel.Mac updates to the
// bundle ID, so a release names its own and keeps it for good.
function checkBundleId() {
  if (!bundleId) {
    if (signingIdentity) {
      throw new Error(
        'Set NOD_BUNDLE_ID for a release: the macOS bundle ID, such as org.example.nod.',
      );
    }
    return;
  }
  if (!/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(bundleId)) {
    throw new Error(
      'NOD_BUNDLE_ID must be a reverse-DNS name such as org.example.nod',
    );
  }
}

function manifestField(key: string): string {
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(import.meta.dirname, 'package.json'), 'utf8'),
  );
  const value: unknown =
    typeof manifest === 'object' && manifest !== null
      ? Reflect.get(manifest, key)
      : undefined;
  if (typeof value !== 'string') {
    throw new Error(`package.json has no ${key}`);
  }
  return value;
}

// Squirrel.Windows downloads the icon it shows in Programs and Features when
// it installs; without one of ours it fetches Electron's from GitHub. Every
// release carries the same one, so the latest serves test installs too.
const windowsIconUrl = releasesPage
  ? `${releasesPage}/latest/download/${manifestField('productName')}.ico`
  : '';

async function signDmg(dmg: string, identity: string, credentials?: Notary) {
  await run('codesign', ['--sign', identity, '--timestamp', dmg]);
  if (credentials) {
    await run('xcrun', [
      'notarytool',
      'submit',
      dmg,
      ...notarytoolCredentials(credentials),
      '--wait',
    ]);
    await run('xcrun', ['stapler', 'staple', dmg]);
    await run('xcrun', ['stapler', 'validate', dmg]);
  }
}

const nativeModules = [
  { name: '@fugood/whisper.node', binary: '@fugood/node-whisper' },
  { name: '@fugood/llama.node', binary: '@fugood/node-llama' },
];

// The Vite plugin ships only its bundles, so the speech and summary addons it
// leaves external are copied in: the loader plus the one prebuilt binary for
// the target, never the sources or other platforms' builds.
async function copyNativeModules(
  buildPath: string,
  platform: string,
  arch: string,
) {
  const target = (name: string) => path.join(buildPath, 'node_modules', name);
  for (const { name, binary } of nativeModules) {
    const source = requirePackageDir(name, import.meta.url);
    await cp(
      path.join(source, 'package.json'),
      path.join(target(name), 'package.json'),
    );
    await cp(path.join(source, 'lib'), path.join(target(name), 'lib'), {
      recursive: true,
      filter: (file) => !file.endsWith('.ts') && !file.endsWith('.mjs'),
    });
    const platformBinary = `${binary}-${platform}-${arch}`;
    const binarySource = packageDir(
      platformBinary,
      path.join(source, 'package.json'),
    );
    if (binarySource === undefined) {
      throw new Error(
        `${platformBinary} is not installed; pnpm installs only the host's build, so package on a ${platform}-${arch} machine.`,
      );
    }
    await cp(binarySource, target(platformBinary), { recursive: true });
  }
}

// Packaging runs on the target platform (copyNativeModules insists), so the
// dependencies pnpm reports here are the ones this build ships.
async function writeThirdPartyNotices(buildPath: string) {
  await run(process.execPath, [
    path.resolve(import.meta.dirname, '../../scripts/third-party-notices.ts'),
    'desktop',
    path.join(path.dirname(buildPath), 'THIRD_PARTY_NOTICES.txt'),
  ]);
}

const config: ForgeConfig = {
  packagerConfig: {
    // Native addons can't be loaded from inside an archive.
    asar: { unpack: '**/*.node' },
    appBundleId: bundleId || undefined,
    icon: 'build/icon',
    extraResource:
      process.platform === 'linux'
        ? ['build/icon.png']
        : process.platform === 'darwin'
          ? ['build/native/nod-mic-monitor']
          : [],
    osxSign: signingIdentity
      ? {
          identity: signingIdentity,
          // The same entitlements the release workflow's signing job uses.
          optionsForFile: (filePath) => ({
            hardenedRuntime: true,
            entitlements: entitlementsFor(filePath),
          }),
        }
      : undefined,
    osxNotarize: signingIdentity && notary ? notary : undefined,
    extendInfo: {
      NSMicrophoneUsageDescription:
        'Your voice is captured so the conversation can be transcribed on this device.',
      NSAudioCaptureUsageDescription:
        'Other participants are captured from your computer audio so the conversation can be transcribed on this device.',
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG({}),
    new MakerZIP({}, ['darwin']),
    new MakerSquirrel({ setupIcon: 'build/icon.ico', iconUrl: windowsIconUrl }),
    // The packager names the Linux binary after productName; the installers
    // would look for one named after the package.
    new MakerDeb({ options: { icon: 'build/icon.png', bin: 'Nod' } }),
    new MakerRpm({ options: { icon: 'build/icon.png', bin: 'Nod' } }),
  ],
  hooks: {
    prePackage: async () => {
      checkRelayUrl();
      checkUpdateUrl();
      checkBundleId();
    },
    generateAssets: async (_config, platform) => {
      if (platform === 'darwin') {
        await run('node', ['scripts/build-mic-monitor.ts']);
      }
    },
    // Packaging edits Info.plist after Electron was signed, and macOS keeps an
    // app with a broken signature out of the keychain, so meetings could not
    // be encrypted. Builds without a signing identity get an ad-hoc signature.
    postPackage: async (_config, { platform, outputPaths }) => {
      if (platform !== 'darwin' || signingIdentity) {
        return;
      }
      for (const outputPath of outputPaths) {
        const apps = (await readdir(outputPath)).filter((name) =>
          name.endsWith('.app'),
        );
        for (const app of apps) {
          // --deep signs nested bundles, not loose programs in Resources.
          const monitor = path.join(
            outputPath,
            app,
            'Contents',
            'Resources',
            'nod-mic-monitor',
          );
          if (existsSync(monitor)) {
            await run('codesign', ['--force', '--sign', '-', monitor]);
          }
          await run('codesign', [
            '--force',
            '--deep',
            '--sign',
            '-',
            path.join(outputPath, app),
          ]);
        }
      }
    },
    packageAfterCopy: async (
      _config,
      buildPath,
      _electronVersion,
      platform,
      arch,
    ) => {
      await copyNativeModules(buildPath, platform, arch);
      await writeThirdPartyNotices(buildPath);
    },
    // osxNotarize covers the app inside the ZIP; the DMG is a separate
    // download that Gatekeeper checks on its own, so it is signed (and,
    // with notary credentials, notarized and stapled) too.
    postMake: async (_config, results) => {
      if (signingIdentity) {
        const dmgs = results
          .flatMap((result) => result.artifacts)
          .filter((artifact) => artifact.endsWith('.dmg'));
        for (const dmg of dmgs) {
          await signDmg(dmg, signingIdentity, notary);
        }
      }
      return results;
    },
  },
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: { main: 'src/main/index.ts' },
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: { transcriber: 'src/main/transcription/worker.ts' },
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: { preload: 'src/preload/index.ts' },
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
