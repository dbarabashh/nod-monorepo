---
description: Every dependency ships code next to user data; add them rarely and keep the supply chain locked.
globs: 'package.json, pnpm-lock.yaml, pnpm-workspace.yaml, app.json, .github/**'
alwaysApply: false
---

- Prefer React Native, Expo SDK modules and Web platform APIs, or a dependency already in the tree, over adding a package. Each new dependency is code with access to user data.
- Before adding a package, check what it pulls in (`pnpm why`, the size of its dependency tree), its maintenance, whether it supports the New Architecture, whether it runs install scripts, and what native code and permissions it adds. Say why it is needed.
- Add packages with `pnpm exec expo install <name>`, which picks the version that matches the Expo SDK. Run `pnpm exec expo install --check` after SDK upgrades.
- Keep `dependencies` minimal, because they ship inside the app. Build and dev tooling goes in `devDependencies`.
- Allow install scripts only by listing the package under `allowBuilds` in `pnpm-workspace.yaml`, and only after reading what the script does.
- Always commit `pnpm-lock.yaml`. Install with the frozen lockfile in CI, and never hand-edit the lockfile.
- pnpm refuses any version published less than 7 days ago (`minimumReleaseAge: 10080` in `pnpm-workspace.yaml`). Fresh releases are where hijacked packages land. Never lower the value or disable it to get an install through.
- Add a `minimumReleaseAgeExclude` entry only for an exact version (`name@x.y.z`) that is an urgent security fix or was already installed before the rule existed. Use a version-less name pattern only for per-platform binary packages whose version the parent package pins (`@expo/modules-macros-*`). Remove each entry once its version is older than 7 days.
- Never add a package that phones home, collects telemetry or analytics, or downloads code or models outside our pinned, verified list. Check native SDKs too, not only the JS.
- Never load remote code in the app: no remote JS bundles, no `eval` of fetched text, no CodePush-style updates that bypass review. Everything that runs is bundled at build time. Enable `expo-updates` only after deciding it explicitly, with code signing.
- Expo CLI telemetry stays off: run Expo through the `pnpm start|ios|android` scripts, which set `EXPO_NO_TELEMETRY=1` (`scripts/expo.mts`).
- Pin every GitHub Action to a full commit SHA with the version in a comment (`uses: actions/checkout@<sha> # v7.0.1`), never to a tag.
