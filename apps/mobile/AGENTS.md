# Mobile app (`apps/mobile`)

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

The data model, sync and crypto come from `@nod/core` (`packages/core`), the
same code the desktop app runs. Its Automerge documents run on
`@nod/automerge-native`: `src/lib/automerge.ts` installs it before anything
else, and `metro.config.js` keeps Automerge's wasm build out of the bundle.
The Diagnostics screen (dev builds) checks it against what desktop writes.

A phone joins by scanning the pairing code the desktop app shows (Settings →
Sync → Pair a phone; see "Pairing a phone by QR code" in
`docs/decisions/0001-sync.md`) and syncs through that relay. `src/lib/sync`
holds the sync layer both features use: meetings are kept by the store in
`@nod/core/meetings`, the one the desktop app uses; `session.ts` is plain
logic tested on Node; `device.ts` adapts both to Expo (`expo-file-system`,
`expo-secure-store`, `expo/fetch`); and `sync.ts` runs them and exposes
hooks. Notes shared with other people, one to one or in a team
(`docs/decisions/0003-sharing.md`), ride on the same session: the core
sharing session gets its files and relays from `device.ts` (a one-to-one
vault goes through the person's own relay; a team vault is reached on the
relay its access list lives on, every request signed by the person's
identity), and `features/shared-notes` shows and edits what arrives, read
only where the person is a reader; adding people, joining and managing teams
and sharing a meeting happen on the computer. `src/lib/random.ts` backs
`crypto.getRandomValues` with `expo-crypto` and is imported first.

Recording transcribes on the phone with whisper.cpp (`whisper.rn`), the
engine family the desktop app uses, through the same chunking in
`@nod/core/transcription`. `src/lib/recording` holds it: `recorder.ts` is plain
logic tested on Node; `recording.ts` wires it to the microphone and the
engine; `models.ts` downloads the phone models listed in `@nod/core/models` and
moves a file in only after its size and sha256 match. Two local modules in
`modules/` do what no Expo module does: `audio-capture` hands the microphone to
JavaScript as 16 kHz PCM in memory (an iOS audio session for the background,
an Android foreground service of type `microphone`), and `file-digest` hashes
model files off the JavaScript thread. Nothing the app keeps goes into a
backup: `src/lib/storage.ts` names every file and folder and marks them with
the iOS-only `backup-exclusion` module at each launch, and
`plugins/with-no-backup.js` gives Android backup rules that exclude
everything, from the cloud and from a transfer to a new phone. Whisper runs on the CPU: iOS refuses GPU
work from an app in the background. `buffer` is there only because whisper.rn
imports it.

Rules for this app: `expo.md` and `styling-mobile.md` in `.agents/rules`, plus
the repository-wide ones listed in the root `AGENTS.md`. Skills:
`add-mobile-feature`, `add-mobile-ui-component`.

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

## Commands

Run from this folder, or from the root with `pnpm --filter nod-mobile <script>`
(`pnpm ios` and `pnpm android` also work from the root):

```sh
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
modules/          local Expo modules for native capabilities (speech, audio)
assets/           app icon, splash and bundled images
```

Create a folder when the first file needs it; don't create empty ones.

Dependencies point one way:
`app → features → components/ui, theme, lib → @nod/core`. Code under `src`
imports `@nod/core/<domain>` by its package name, never through a relative
path, and never an alias such as `@/`. `.oxlintrc.json` enforces the alias
rule.

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

- Add packages with `pnpm exec expo install <name>` from this folder, so the
  version matches the Expo SDK. Native dependencies that run build scripts must
  be listed under `allowBuilds` in the root `pnpm-workspace.yaml`.
- `package.json` → `expo.autolinking.buildFromSource` builds `expo-camera`,
  `expo-crypto` and `expo-secure-store` from source: their precompiled iOS
  binaries were built against another `expo-modules-core` and crash at launch
  with a missing symbol. Remove an entry once the precompiled module matches
  the installed `expo-modules-core`.
- The app targets iOS and Android. Gate platform behavior on `Platform.OS`;
  never assume one of them.
- Never create or edit `ios/` or `android/`. They are generated from
  `app.json` and config plugins (Continuous Native Generation).
- Build UI from `components/ui`. Feature styles only lay out the feature,
  never restyle a primitive.
- Don't call impure functions (`new Date()`, `Math.random()`) during render.
  Capture them once in state or pass them in.
