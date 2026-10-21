# Nod

A local-first meeting notetaker. Meetings stay on your devices, encrypted, and
sync between them end to end encrypted. Audio is transcribed on the device and
never stored.

- `apps/desktop`: the app for macOS, Windows and Linux (Electron)
- `apps/mobile`: the app for iOS and Android (Expo)
- `packages/core`: the data model, sync and crypto both apps share
- `docs/decisions`: why things are built the way they are

## Develop

Requires Node 24+ and pnpm. The mobile app also needs Xcode, or JDK 17 and the
Android SDK; see `apps/mobile/README.md`.

```sh
pnpm install
pnpm desktop     # the desktop app in dev mode
pnpm ios         # or: pnpm android
pnpm typecheck && pnpm lint && pnpm test
```

Contributor and agent rules live in `AGENTS.md` and `.agents/`.
