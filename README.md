# Nod for iOS and Android

The mobile client of Nod, a local-first meeting notetaker. It keeps meetings on
the device, encrypted, and syncs them end to end encrypted with the desktop
app. Audio is transcribed on the device and never stored.

## Develop

Requires Node 24+ and pnpm, plus Xcode for iOS, and for Android JDK 17 and the
Android SDK with `JAVA_HOME` and `ANDROID_HOME` set in your shell. The app runs
as a development build; Expo Go lacks its native modules.

```sh
pnpm install
pnpm ios        # or: pnpm android
```

`pnpm typecheck && pnpm lint && pnpm test` must pass before a change is done.
Agent and contributor rules live in `AGENTS.md` and `.agents/`.
