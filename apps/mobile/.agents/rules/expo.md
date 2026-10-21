---
description: Expo and React Native platform rules — native config, permissions, background work, secrets.
globs: 'src/**, app.json, app.config.ts, eas.json, modules/**, plugins/**'
alwaysApply: false
---

- Expo changes every SDK. Read the `expo` major in `package.json` and check `https://docs.expo.dev/versions/v<major>.0.0/` (or `https://docs.expo.dev/llms.txt`) before using an Expo, EAS or React Native API. Never write one from memory.
- Never create or edit `ios/` or `android/` by hand. They are generated (Continuous Native Generation) and ignored by git. Configure native behavior in `app.json` and config plugins, and put custom native code in a local Expo module under `modules/`.
- Run the app as a development build (`pnpm ios`, `pnpm android`, or an EAS development build). Expo Go lacks the native modules the app needs, so never design around it.
- Request the narrowest permissions, only at the moment a feature needs them, with a usage string that says why (`NSMicrophoneUsageDescription`, `RECORD_AUDIO`). Never declare a permission no shipped feature uses; every one is reviewed by the stores and the user.
- Declare background capabilities only for recording that is running: the iOS `audio` background mode and an Android foreground service of type `microphone` with a visible notification. Never keep the microphone or the process alive when nothing is recorded.
- Store keys and tokens only with `expo-secure-store` (Keychain / Keystore). Never put secrets in source, `app.json`, `EXPO_PUBLIC_*` variables or the JS bundle; anyone can read them from the app binary.
- Open links with `expo-web-browser` or `Linking.openURL` only after checking the URL is `https:` (or `mailto:`). Treat every deep link and QR payload as untrusted input and validate it before acting on it.
- Keep heavy work (transcription, summaries, encryption of large data, sync merges) off the JS thread: in a native module, a worklet or a native thread. A blocked JS thread freezes every screen.
- Write code for iOS and Android. Gate platform behavior with `Platform.OS` / `Platform.select`, never assume one OS, and follow each platform's conventions (back gesture and hardware back on Android, safe areas on both).
- Build file paths with `expo-file-system` directories (`Paths.document`, `Paths.cache`), never hardcoded locations. Keep user data out of iCloud and Google backups unless the user opts in, because a backup is a copy outside the user's sync. Do it natively: `NSURLIsExcludedFromBackupKey` on iOS and backup rules in the Android manifest, set through a local module or config plugin.
- Never disable the New Architecture or Hermes to work around a library; replace the library instead.
- Open developer tools and verbose logging only in `__DEV__`.
