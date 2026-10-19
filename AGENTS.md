# Agent guide

## What this is

A local-first, cross-platform desktop app for capturing conversations and
recalling them later (a meeting notetaker). User data lives on the user's own
devices and is encrypted there. Sync between devices is end-to-end encrypted.
Audio is processed without ever being stored. Desktop comes first (macOS,
Windows, Linux). Mobile clients come later, so the data model and sync must not
depend on Electron or on a single OS. `local-first.md` turns this into rules.

Electron Forge 8 packages the app, Vite bundles the main, preload and renderer
targets, and TypeScript runs in strict mode. The renderer uses React with a
plain-CSS design system (`src/renderer/components/ui`).

The project is meant to be open source and forkable. Keep code, docs and agent
context free of personal or company identity: no names, emails, private URLs,
internal service IDs or paths that exist only on one machine.

## Agent context layout

`AGENTS.md` is canonical. `CLAUDE.md` is a **symlink** to it, so edit
`AGENTS.md` and never the symlink. Shared agent behavior lives in `AGENTS.md` or
`.agents/` and never only in one tool's config.

- `.agents/rules/` holds one topic per file and is symlinked as `.claude/rules`.
  The format is in `README.md` there. **Read the relevant rule before editing
  matching files:**
  - `local-first.md` (always): user data stays on the device, encrypted, works offline, syncs end to end
  - `commits.md` (always): signed commits only; lowercase, 4–5 words, no AI attribution trailer
  - `comments.md` (always): no narration comments; only a non-obvious WHY
  - `testing.md` (always): tests must be able to fail; logic changes are checked against their tests
  - `loop-engineering.md` (always): independent review/fix loops before material work is ready
  - `dependencies.md` (`package.json`, `pnpm-*.yaml`, `.github/**`): every dependency is supply-chain risk to user data
  - `electron.md` (`src/**`, `forge.config.mts`): process boundaries, IPC, window security, fuses
  - `styling.md` (`src/renderer/**`): plain CSS, tokens only, cascade layers, no translucency
  - `typescript.md` (`*.ts`, `*.tsx`, `*.mts`): strict types, no `any`, pnpm only
- `.agents/skills/<name>/SKILL.md` uses the [Agent Skills](https://agentskills.io)
  format. Claude Code loads each skill through a symlink in `.claude/skills/`.
  - `add-feature`: add a feature or extend one across core, IPC, main and renderer
  - `add-ui-component`: add or change a design-system primitive in plain CSS
  - `add-ipc`: add a typed main ↔ renderer channel through the preload bridge
  - `write-tests`: write or update node:test unit tests without false positives
  - `build-macos`: build the DMG and ZIP locally and verify them

  New skills go in `.agents/skills/<name>/` with a matching symlink.

- `.agents/hooks/format-edited-files.sh` is the shared formatter hook. Claude
  Code calls it from `.claude/settings.json` and Codex calls it from
  `.codex/hooks.json`. Keep both adapters behaviorally equivalent.

## Commands

```sh
pnpm install
pnpm start       # dev mode with Vite HMR and DevTools open
pnpm typecheck   # tsc --noEmit, strict
pnpm test        # node:test over src/**/*.test.ts (Node >= 24)
pnpm lint        # oxlint + oxfmt --check + type-assertion check
pnpm lint:fix    # oxlint --fix + oxfmt --write
pnpm make        # installers for the host OS into out/make
```

Run `pnpm typecheck && pnpm lint && pnpm test` before calling a change done.
CI (`.github/workflows/ci.yml`) runs the same three on every push to `main` and
every pull request. Dependabot (`.github/dependabot.yml`) proposes npm and
GitHub Actions updates weekly; see `dependencies.md`.

## Structure

```
src/
  main/        Electron main: lifecycle, windows, IPC handlers, OS adapters
  preload/     the only bridge: exposes window.api via contextBridge
  renderer/    the UI (Vite root, index.html), split into feature slices
  shared/      contracts imported by several processes (IPC channels and types)
  core/        platform-neutral data model, migrations, sync, crypto
  declarations.d.ts  ambient types (Forge Vite globals, window.api)
build/         packaging assets: app icon as icon.icns (macOS), icon.ico (Windows)
               and icon.png (Linux, 1024 px), plus entitlements.mac.plist for
               the signed macOS build, all wired in forge.config.mts
docs/decisions/  numbered decision records; read 0001-sync.md before
                 touching meetings storage or sync
relay/         the optional self-hostable sync relay (no dependencies)
```

Dependencies point one way: `renderer → shared ← preload ← main → core`.
`core` stays free of Electron and Node so it can become its own package when a
mobile client arrives. `renderer` is untrusted web content. `.oxlintrc.json`
enforces both boundaries for `import` statements, including nested relative
paths and bare Node built-ins. It can't see `require()`, so don't use it in
these layers.

Each layer has its own `AGENTS.md` (with a `CLAUDE.md` symlink) holding its
layout and rules. Read it before editing that layer. To add or extend a
feature across layers, use the `add-feature` skill.

## Conventions

- Use pnpm only. Native dependencies that run build scripts must be listed
  under `allowBuilds` in `pnpm-workspace.yaml`, or they install unbuilt.
- The app targets macOS, Windows and Linux. Makers: DMG + ZIP for macOS,
  Squirrel for Windows, deb + rpm for Linux. Forge runs only the makers for the
  host platform. Write code that works on all three: no hardcoded paths or
  separators, use `app.getPath()` and `node:path`, and gate OS-specific
  behavior on `process.platform`.
- Open DevTools only when `!app.isPackaged`.
- Commit or push only when asked. Branch first if the change is non-trivial and
  you're on `main`.
