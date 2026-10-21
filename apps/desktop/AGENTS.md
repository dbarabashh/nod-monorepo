# Desktop app (`apps/desktop`)

The Electron client of Nod for macOS, Windows and Linux. Electron Forge 8
packages the app, Vite bundles the main, preload and renderer targets, and
TypeScript runs in strict mode. The renderer uses React with a plain-CSS design
system (`src/renderer/components/ui`). The data model, sync and crypto come from
`@nod/core` (`packages/core`), which the mobile app shares.

Rules for this app: `electron.md` and `styling-desktop.md` in `.agents/rules`,
plus the repository-wide ones listed in the root `AGENTS.md`. Skills:
`add-desktop-feature`, `add-desktop-ui-component`, `add-ipc`, `build-macos`.

## Commands

Run from this folder, or from the root with `pnpm --filter nod-desktop <script>`:

```sh
pnpm start       # dev mode with Vite HMR and DevTools open
pnpm typecheck   # tsc --noEmit, strict
pnpm test        # node:test over src/**/*.test.ts and relay/**/*.test.ts
pnpm lint        # oxlint + oxfmt --check + type-assertion check
pnpm make        # installers for the host OS into out/make
                 # NOD_RELAY_URL=<https address> offers that relay in the build
```

## Structure

```
src/
  main/        Electron main: lifecycle, windows, IPC handlers, OS adapters
  preload/     the only bridge: exposes window.api via contextBridge
  renderer/    the UI (Vite root, index.html), split into feature slices
  shared/      contracts imported by several processes (IPC channels and types)
  declarations.d.ts  ambient types (Forge Vite globals, window.api)
build/         packaging assets: app icon as icon.icns (macOS), icon.ico (Windows)
               and icon.png (Linux, 1024 px), plus entitlements.mac.plist for
               the signed macOS build, all wired in forge.config.mts
relay/         the optional self-hostable sync relay (no dependencies); its
               tests run with this app's because they use its sync transport
native/macos/  the microphone monitor (C, CoreAudio) that notices a meeting
               starting; Forge builds it into build/native on macOS
scripts/       start, the mic monitor build, and package lookup in the workspace
```

Dependencies point one way: `renderer → shared ← preload ← main → @nod/core`.
`renderer` is untrusted web content. `.oxlintrc.json` enforces the renderer
boundary for `import` statements, including nested relative paths and bare
Node built-ins. It can't see `require()`, so don't use it in these layers.

Each layer has its own `AGENTS.md` (with a `CLAUDE.md` symlink) holding its
layout and rules. Read it before editing that layer.

## Conventions

- The workspace hoists `node_modules` to the repository root. Find a package
  with `scripts/package-dir.ts`, never by joining `node_modules` to this folder.
- Makers: DMG + ZIP for macOS, Squirrel for Windows, deb + rpm for Linux. Forge
  runs only the makers for the host platform. Write code that works on all
  three: no hardcoded paths or separators, use `app.getPath()` and `node:path`,
  and gate OS-specific behavior on `process.platform`.
- Open DevTools only when `!app.isPackaged`.
