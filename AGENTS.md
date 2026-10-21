# Agent guide

## What this is

The iOS and Android client of Nod, a local-first app for capturing
conversations and recalling them later (a meeting notetaker). It reads and
writes the same data as the desktop app and syncs with it end to end
encrypted; devices pair by QR code. User data lives on the user's own devices
and is encrypted there. Audio is transcribed on the device and never stored.
`local-first.md` turns this into rules.

The app is built with Expo (dev builds, never Expo Go), React Native's New
Architecture on Hermes, Expo Router and TypeScript in strict mode. The UI uses
a small design system (`src/components/ui`) whose tokens and components mirror
the desktop app's, so both clients look like one product.

The project is meant to be open source and forkable. Keep code, docs and agent
context free of personal or company identity: no names, emails, private URLs,
internal service IDs or paths that exist only on one machine.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely
renamed, moved or removed. Before writing code that touches an Expo, EAS or
React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
   (append `.md` to a page's path for markdown).
3. For anything else, fetch `https://docs.expo.dev/llms.txt`, an index of all
   Expo docs with corrections to common LLM misconceptions. Follow its links to
   the page you need; never answer from memory.

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
  - `dependencies.md` (`package.json`, `pnpm-*.yaml`, `app.json`, `.github/**`): every dependency is supply-chain risk to user data
  - `expo.md` (`src/**`, `app.json`, `modules/**`): native config, permissions, background work, secrets
  - `styling.md` (`src/**/*.tsx`, `src/theme/**`): tokens only, light and dark, no translucency, touch targets
  - `typescript.md` (`*.ts`, `*.tsx`): strict types, no `any`, no assertions, pnpm only
- `.agents/skills/<name>/SKILL.md` uses the [Agent Skills](https://agentskills.io)
  format. Claude Code loads each skill through a symlink in `.claude/skills/`.
  - `add-feature`: add a feature or extend one across core, native, feature and route
  - `add-ui-component`: add or change a design-system primitive
  - `write-tests`: write or update node:test unit tests without false positives

  New skills go in `.agents/skills/<name>/` with a matching symlink.

- `.agents/hooks/format-edited-files.sh` is the shared formatter hook. Claude
  Code calls it from `.claude/settings.json` and Codex calls it from
  `.codex/hooks.json`. Keep both adapters behaviorally equivalent.

## Commands

```sh
pnpm install
pnpm ios           # dev build on the iOS simulator (expo run:ios)
pnpm android       # dev build on an Android emulator or device (expo run:android)
pnpm start         # Metro for an installed dev build
pnpm typecheck     # tsc --noEmit, strict
pnpm test          # node:test over src/**/*.test.ts (Node >= 24)
pnpm lint          # oxlint + oxfmt --check + type-assertion check
pnpm lint:fix      # oxlint --fix + oxfmt --write
pnpm exec expo install <package>   # add a package at the SDK's version
pnpm exec expo-doctor              # diagnose dependency and config issues
```

Run `pnpm typecheck && pnpm lint && pnpm test` before calling a change done.

## Structure

```
src/
  app/            Expo Router routes: every file is a screen, _layout.tsx files
                  are navigators. Thin: they render a feature's entry view.
  features/       one self-contained slice per product area
  components/ui/  the design system (see its AGENTS.md)
  theme/          tokens (mirroring the desktop tokens.css), themed(), useScheme()
  lib/            helpers and hooks used by 2+ features
  core/           platform-neutral data model, sync, crypto; shared with desktop
modules/          local Expo modules for native capabilities (speech, audio)
assets/           app icon, splash and bundled images
```

Create a folder when the first file needs it; don't create empty ones.

Dependencies point one way: `app → features → components/ui, theme, lib → core`.
`core` stays free of React Native, Expo and Node, so the desktop app and this
one can run the same code. `.oxlintrc.json` enforces it for `import`
statements.

A feature slice:

```
features/<feature>/
  index.ts            barrel: the ONLY thing other modules import
  <feature>-view.tsx  the entry view a route renders
  components/         views used only by this feature
  hooks/              state and effects for this feature
  lib/                pure helpers, unit-tested
  types.ts            types used only inside the feature
```

Import a feature only through its barrel, and never one feature from another;
promote shared code to `components/ui` or `lib` first.

## Conventions

- Use pnpm only. Native dependencies that run build scripts must be listed
  under `allowBuilds` in `pnpm-workspace.yaml`, or they install unbuilt.
- The app targets iOS and Android. Gate platform behavior on `Platform.OS`;
  never assume one of them.
- Never create or edit `ios/` or `android/`. They are generated from
  `app.json` and config plugins (Continuous Native Generation).
- Build UI from `components/ui`. Feature styles only lay out the feature,
  never restyle a primitive.
- Don't call impure functions (`new Date()`, `Math.random()`) during render.
  Capture them once in state or pass them in.
- Commit or push only when asked. Branch first if the change is non-trivial and
  you're on `main`.
