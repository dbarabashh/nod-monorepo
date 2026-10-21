---
name: build-macos
description: Build the desktop app for macOS locally, producing the DMG and ZIP with electron-forge make, and verify the artifacts. Use when asked to build, package, make a DMG, or check that the packaged app works.
---

# Build for macOS

Paths are relative to `apps/desktop`, except those starting with `packages/`,
and commands run from there.

`pnpm make` runs `electron-forge make`: Vite builds main, preload and renderer;
Forge packages the `.app` with asar and fuses; then the DMG and ZIP makers run.
Artifacts land in `out/make/`.

Signing and notarization are driven by two environment variables, and both
stay out of the repo:

- `APPLE_SIGNING_IDENTITY`: a "Developer ID Application" identity in the
  keychain (`security find-identity -v -p codesigning`). Forge signs the app
  with the hardened runtime and `build/entitlements.mac.plist`.
- `APPLE_NOTARY_PROFILE`: a notarytool keychain profile, created once with
  `xcrun notarytool store-credentials <profile> --apple-id <id> --team-id <team> --password <app-specific-password>`.
  With both set, Forge notarizes and staples the app (so the ZIP is covered),
  and the `postMake` hook signs, notarizes and staples the DMG. With only the
  identity set, the app and DMG are signed but not notarized.

The relay a build offers in onboarding and Settings → Sync comes from
`NOD_RELAY_URL` at build time; nothing in the repo names one. Set it to the
relay's `https://` address, or to an empty value for a build without a relay.
A signed build refuses to start without it, so a release never ships without a
relay by accident, and an address the app would refuse fails the build. When
releases move to CI, keep the address in a repository variable, not in code.

Without them the build is unsigned and for local testing only. Never hand an
unsigned or unnotarized build to users, because macOS shows "developer cannot
be verified" on every other machine. Notarization uploads the build to Apple
and blocks until Apple answers (minutes), so run it only for a release.

An ad-hoc identity (`-`) can't test the signed build: under the hardened
runtime macOS refuses to load the Electron framework without a team ID.

## Preconditions

1. `pnpm install` has completed with no `Ignored build scripts` warning. The DMG
   maker depends on native modules, which build only if they are listed under
   `allowBuilds` in `pnpm-workspace.yaml`.
2. `pnpm typecheck && pnpm lint` pass. `make` doesn't type-check, so a type
   error would ship silently.

## Steps

1. Clean old output: `rm -rf out`.
2. Build: `NOD_RELAY_URL=<relay address> pnpm make`, or for a release
   `NOD_RELAY_URL=<relay address> APPLE_SIGNING_IDENTITY="Developer ID Application" APPLE_NOTARY_PROFILE=<profile> pnpm make`. To build for the other architecture, use
   `pnpm make --arch=x64` or `--arch=universal`.
3. Check the artifacts exist:

   ```sh
   find out/make -type f \( -name '*.dmg' -o -name '*.zip' \)
   ```

   Expect `out/make/dmg/<arch>/<productName>-<version>-<arch>.dmg` and
   `out/make/zip/darwin/<arch>/<productName>-darwin-<arch>-<version>.zip`.

4. Smoke-test the packaged app, not `pnpm start`:

   ```sh
   open out/*-darwin-"$(uname -m)"/*.app
   ```

   The window opens with **no** DevTools, because the app is packaged. If the
   window is blank, the renderer path or CSP is wrong. Check it before shipping.
   With `NOD_RELAY_URL` set, Settings → Sync offers "Sync through <host>".

5. Mount the DMG (`hdiutil attach <dmg>`) and confirm it contains the `.app`.

## Troubleshooting

- `Cannot find module '…/build/Release/….node'` means a native module was
  installed unbuilt. Make sure they are in `allowBuilds`, then run
  `rm -rf node_modules && pnpm install`.
- The ZIP builds but the DMG fails: read the first `✖` line of the output. It
  is almost always the native-module problem above.

## Rules

- Never commit `out/`.
- Never change fuses or set `asar: false` to make a build pass.
- `productName` in `package.json` drives the artifact and `.app` names. Don't
  rename it as a side effect of a build fix.
