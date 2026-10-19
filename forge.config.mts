import { execFile } from 'node:child_process';
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

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
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
