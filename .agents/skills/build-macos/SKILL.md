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
  and its helpers with the hardened runtime and the entitlements
  `scripts/macos-signing.ts` picks, the same ones the release workflow uses.
- `APPLE_NOTARY_PROFILE`: a notarytool keychain profile, created once with
  `xcrun notarytool store-credentials <profile> --apple-id <id> --team-id <team> --password <app-specific-password>`.
  With both set, Forge notarizes and staples the app (so the ZIP is covered),
  and the `postMake` hook signs, notarizes and staples the DMG. With only the
  identity set, the app and DMG are signed but not notarized.
- Instead of a profile, CI notarizes with an App Store Connect API key:
  `APPLE_API_KEY` (the path to the `.p8` file), `APPLE_API_KEY_ID` and
  `APPLE_API_ISSUER`. A profile wins when both are set.

The relay a build offers in onboarding and Settings → Sync comes from
`NOD_RELAY_URL` at build time; nothing in the repo names one. Set it to the
relay's `https://` address, or to an empty value for a build without a relay.
A signed build refuses to start without it, so a release never ships without a
relay by accident, and an address the app would refuse fails the build. The
release workflow takes it from the `NOD_RELAY_URL` repository variable.

`NOD_UPDATE_URL` works the same way for updates: the releases page installed
copies update from (`https://github.com/<owner>/<repo>/releases`), or empty
for a build that never checks. A signed build requires it too, and an address
requires `NOD_UPDATE_PUBLIC_KEY`, the release key's public half (skill
`release-desktop`). Releases for
users come from CI (skill `release-desktop`), not from a local build.

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
