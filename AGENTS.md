# Agent guide

## What this is

Nod is a local-first app for capturing conversations and recalling them later
(a meeting notetaker). User data lives on the user's own devices and is
encrypted there. Sync between devices is end-to-end encrypted. Audio is
processed without ever being stored. `local-first.md` turns this into rules.

This repository holds every client and the code they share:

```
apps/desktop/    Electron app for macOS, Windows and Linux (Forge, Vite, React,
                 plain CSS), plus the optional sync relay in apps/desktop/relay
apps/mobile/     Expo app for iOS and Android (Expo Router, React Native)
packages/core/   @nod/core: the platform-neutral data model, migrations, sync
                 and crypto both apps run unchanged
docs/decisions/  numbered decision records; read 0001-sync.md before touching
                 meetings storage or sync
scripts/         repository tooling shared by every package
```

Dependencies point one way: `apps/* → @nod/core`. Core never imports an app,
and it stays free of Electron, React Native, Expo and Node, so each app can run
it. Its `.oxlintrc.json` enforces that. One gap remains: core's meeting
documents use `@automerge/automerge`, which needs WebAssembly, and Hermes on
mobile has none. Before mobile reads meetings, the Automerge runtime moves
behind an interface each app implements (a native module on mobile).

The project is meant to be open source and forkable. Keep code, docs and agent
context free of personal or company identity: no names, emails, private URLs,
internal service IDs or paths that exist only on one machine.

## Agent context layout

`AGENTS.md` is canonical. Every `CLAUDE.md` is a **symlink** to the
`AGENTS.md` next to it, so edit `AGENTS.md` and never the symlink. Shared agent
behavior lives in `AGENTS.md` files or `.agents/` and never only in one tool's
config.

Each app and package has its own `AGENTS.md` with its layout, commands and
rules, and its layers have more. Read the ones on the path to a file before
editing it.

- `.agents/rules/` holds one topic per file and is symlinked as `.claude/rules`.
  The format is in `README.md` there. **Read the relevant rule before editing
  matching files:**
  - `local-first.md` (always): user data stays on the device, encrypted, works offline, syncs end to end
  - `commits.md` (always): signed commits only; lowercase, 4–5 words, no AI attribution trailer
  - `comments.md` (always): no narration comments; only a non-obvious WHY
  - `testing.md` (always): tests must be able to fail; logic changes are checked against their tests
  - `loop-engineering.md` (always): independent review/fix loops before material work is ready
  - `dependencies.md` (`package.json`, `pnpm-*.yaml`, `.github/**`): every dependency is supply-chain risk to user data
  - `typescript.md` (`*.ts`, `*.tsx`, `*.mts`): strict types, no `any`, no assertions, pnpm only
  - `electron.md` (`apps/desktop/src/**`, `forge.config.mts`): process boundaries, IPC, window security, fuses
  - `styling-desktop.md` (`apps/desktop/src/renderer/**`): plain CSS, tokens only, cascade layers, no translucency
  - `expo.md` (`apps/mobile/**`): native config, permissions, background work, secrets
  - `styling-mobile.md` (`apps/mobile/src/**`): StyleSheet with tokens, light and dark, no translucency, touch targets
- `.agents/skills/<name>/SKILL.md` uses the [Agent Skills](https://agentskills.io)
  format. Claude Code loads each skill through a symlink in `.claude/skills/`.
  - `add-desktop-feature`: add a desktop feature across core, IPC, main and renderer
  - `add-mobile-feature`: add a mobile feature across core, native, feature and route
  - `add-desktop-ui-component`: add or change a desktop design-system primitive in plain CSS
  - `add-mobile-ui-component`: add or change a mobile design-system primitive
  - `add-ipc`: add a typed main ↔ renderer channel through the desktop preload bridge
  - `write-tests`: write or update node:test unit tests without false positives
  - `build-macos`: build the desktop DMG and ZIP locally and verify them

  New skills go in `.agents/skills/<name>/` with a matching symlink.

- `.agents/hooks/format-edited-files.sh` is the shared formatter hook. It runs
  oxlint and oxfmt from the nearest folder with an `.oxlintrc.json` (a
  package, or the root), so that config applies. Claude Code calls it from `.claude/settings.json`
  and Codex calls it from `.codex/hooks.json`. Keep both adapters behaviorally
  equivalent.
- `.claude/settings.json` also enables the official Expo plugin for Claude Code.
  It only adds Expo documentation and tools; every rule it relies on is written
  down in `.agents/`.

## Commands

From the repository root:

```sh
pnpm install
pnpm typecheck   # every package, strict
pnpm test        # every package's node:test suite (Node >= 24)
pnpm lint        # oxlint + oxfmt --check + type-assertion check, per package
pnpm lint:fix
pnpm desktop     # the desktop app in dev mode
pnpm make        # desktop installers for the host OS into apps/desktop/out/make
pnpm ios         # the mobile app as a dev build on the iOS simulator
pnpm android     # the mobile app as a dev build on an Android emulator
```

Run `pnpm typecheck && pnpm lint && pnpm test` before calling a change done.
One package only: `pnpm --filter <name> <script>` (`nod-desktop`,
`nod-mobile`, `@nod/core`). CI (`.github/workflows/ci.yml`) runs the same three
on every push to `main` and every pull request. Dependabot
(`.github/dependabot.yml`) proposes npm and GitHub Actions updates weekly; see
`dependencies.md`.

## Conventions

- Use pnpm only. The repository is one pnpm workspace with one lockfile at the
  root and a hoisted `node_modules`. Add a dependency to the package that
  imports it; only tooling for root files (oxlint, oxfmt, TypeScript for `scripts/`) lives in the root. Native dependencies that run build scripts
  must be listed under `allowBuilds` in `pnpm-workspace.yaml`, or they install
  unbuilt.
- A change to the data model, a stored format or the sync protocol lands in
  `packages/core` with its migration and tests, and both apps are updated in
  the same change. Older app versions on other devices still read that data.
- Code that runs on several platforms works on all of them: no hardcoded paths
  or separators, and OS-specific behavior gated on `process.platform` (desktop)
  or `Platform.OS` (mobile).
- Commit or push only when asked. Branch first if the change is non-trivial and
  you're on `main`.
