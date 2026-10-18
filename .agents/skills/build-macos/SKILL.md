---
name: build-macos
description: Build the desktop app for macOS locally, producing the DMG and ZIP with electron-forge make, and verify the artifacts. Use when asked to build, package, make a DMG, or check that the packaged app works.
---

# Build for macOS

`pnpm make` runs `electron-forge make`: Vite builds main, preload and renderer;
Forge packages the `.app` with asar and fuses; then the DMG and ZIP makers run.
Artifacts land in `out/make/`.

Signing and notarization are not configured yet. Builds from this skill are for
local testing only. Never hand an unsigned build to users, because macOS shows
"developer cannot be verified" on every other machine.

## Preconditions

1. `pnpm install` has completed with no `Ignored build scripts` warning. The DMG
   maker needs the native modules `fs-xattr` and `macos-alias`, which build only
   if they are listed under `allowBuilds` in `pnpm-workspace.yaml`.
2. `pnpm typecheck && pnpm lint` pass. `make` doesn't type-check, so a type
   error would ship silently.

## Steps

1. Clean old output: `rm -rf out`.
2. Build: `pnpm make`. To build for the other architecture, use
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

5. Mount the DMG (`hdiutil attach <dmg>`) and confirm it contains the `.app`.

## Troubleshooting

- `Cannot find module '../build/Release/volume.node'` means the native modules
  were installed unbuilt. Make sure they are in `allowBuilds`, then run
  `rm -rf node_modules && pnpm install`.
- The ZIP builds but the DMG fails: read the first `✖` line of the output. It
  is almost always the native-module problem above.

## Rules

- Never commit `out/`.
- Never change fuses or set `asar: false` to make a build pass.
- `productName` in `package.json` drives the artifact and `.app` names. Don't
  rename it as a side effect of a build fix.
