import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
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

const run = promisify(execFile);

const signingIdentity = process.env.APPLE_SIGNING_IDENTITY;
const notaryProfile = process.env.APPLE_NOTARY_PROFILE;

async function signDmg(dmg: string, identity: string, profile?: string) {
  await run('codesign', ['--sign', identity, '--timestamp', dmg]);
  if (profile) {
    await run('xcrun', [
      'notarytool',
      'submit',
      dmg,
      '--keychain-profile',
      profile,
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
    const source = path.join(import.meta.dirname, 'node_modules', name);
    await cp(
      path.join(source, 'package.json'),
      path.join(target(name), 'package.json'),
    );
    await cp(path.join(source, 'lib'), path.join(target(name), 'lib'), {
      recursive: true,
      filter: (file) => !file.endsWith('.ts') && !file.endsWith('.mjs'),
    });
    const platformBinary = `${binary}-${platform}-${arch}`;
    const binarySource = path.join(
      import.meta.dirname,
      'node_modules',
      platformBinary,
    );
    if (!existsSync(binarySource)) {
      throw new Error(
        `${platformBinary} is not installed; pnpm installs only the host's build, so package on a ${platform}-${arch} machine.`,
      );
    }
    await cp(binarySource, target(platformBinary), { recursive: true });
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    // Native addons can't be loaded from inside an archive.
    asar: { unpack: '**/*.node' },
    icon: 'build/icon',
    extraResource: process.platform === 'linux' ? ['build/icon.png'] : [],
    osxSign: signingIdentity
      ? {
          identity: signingIdentity,
          // osx-sign's default entitlements also grant camera, location,
          // photos, Bluetooth and USB. Helpers keep their own defaults.
          optionsForFile: (filePath) =>
            /\((GPU|Renderer|Plugin)\)\.app$/.test(filePath)
              ? {}
              : {
                  hardenedRuntime: true,
                  entitlements: 'build/entitlements.mac.plist',
                },
        }
      : undefined,
    osxNotarize:
      signingIdentity && notaryProfile
        ? { keychainProfile: notaryProfile }
        : undefined,
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
    new MakerSquirrel({ setupIcon: 'build/icon.ico' }),
    new MakerDeb({ options: { icon: 'build/icon.png' } }),
    new MakerRpm({ options: { icon: 'build/icon.png' } }),
  ],
  hooks: {
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
    ) => copyNativeModules(buildPath, platform, arch),
    // osxNotarize covers the app inside the ZIP; the DMG is a separate
    // download that Gatekeeper checks on its own, so it is signed (and,
    // with a notary profile, notarized and stapled) too.
    postMake: async (_config, results) => {
      if (signingIdentity) {
        const dmgs = results
          .flatMap((result) => result.artifacts)
          .filter((artifact) => artifact.endsWith('.dmg'));
        for (const dmg of dmgs) {
          await signDmg(dmg, signingIdentity, notaryProfile);
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
