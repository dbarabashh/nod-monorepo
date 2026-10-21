---
description: Every dependency ships code next to user data; add them rarely and keep the supply chain locked.
globs: '**/package.json, pnpm-lock.yaml, pnpm-workspace.yaml, apps/mobile/app.json, .github/**'
alwaysApply: false
---

- Prefer platform APIs (Electron, Node, Web, React Native, Expo SDK modules), or a dependency already in the tree, over adding a package. Each new dependency is code with access to user data.
- Before adding a package, check what it pulls in (`pnpm why`, the size of its dependency tree), its maintenance, whether it runs install scripts, and on mobile whether it supports the New Architecture and what native code and permissions it adds. Say why it is needed.
- Add a package to the workspace package that imports it (`pnpm --filter <name> add`). Only tooling for files at the repository root (oxlint, oxfmt, TypeScript for `scripts/`) lives in the root `package.json`. In the mobile app use `pnpm --filter nod-mobile exec expo install <name>`, which picks the version that matches the Expo SDK.
- Keep `dependencies` minimal, because they ship inside the app. Build and dev tooling goes in `devDependencies`.
- Allow install scripts only by listing the package under `allowBuilds` in `pnpm-workspace.yaml`, and only after reading what the script does.
- Always commit `pnpm-lock.yaml`. Install with the frozen lockfile in CI, and never hand-edit the lockfile.
- pnpm refuses any version published less than 7 days ago (`minimumReleaseAge: 10080` in `pnpm-workspace.yaml`). Fresh releases are where hijacked packages land. Never lower the value or disable it to get an install through.
- Add a `minimumReleaseAgeExclude` entry only for an exact version (`name@x.y.z`) that is an urgent security fix or was already installed before the rule existed. Use a version-less name pattern only for per-platform binary packages whose version the parent package pins (`@oxlint/binding-*`, `@expo/modules-macros-*`). Remove each entry once its version is older than 7 days.
- Never downgrade an already-installed runtime dependency (Electron especially) just to satisfy the age rule. Patch releases often carry security fixes; add a temporary exact-version exclusion instead.
- Never add a package that phones home, collects telemetry or analytics, or loads code from the network at runtime. Check native SDKs too, not only the JS. Expo CLI telemetry stays off: the mobile scripts set `EXPO_NO_TELEMETRY=1`.
- Never load remote code in an app (CDN scripts, remote modules, remote JS bundles, `eval` of fetched text). Everything that runs is bundled at build time. Enable `expo-updates` only after deciding it explicitly, with code signing.
- Dependabot (`.github/dependabot.yml`) opens weekly update PRs and waits 7 days after a release (14 days for majors) before proposing it. Review each PR like a new dependency: read the changelog, and run `pnpm install && pnpm typecheck && pnpm lint && pnpm test`, plus `pnpm make` for desktop changes and an iOS and Android build for mobile ones. Never merge one only because CI is green.
- Electron and Forge packages update together in one Dependabot group. An Electron major changes the bundled Node and Chromium, so check the Electron release notes and rebuild native modules before merging.
- Expo and React Native packages update together in their own group, and only as a whole SDK upgrade (`expo install --fix`). Never bump one of them alone.
- Rust crates follow the same rules: commit `Cargo.lock`, build with `--locked`, pin git dependencies to a revision, and keep every crate version at least 7 days old (pin an older one with `cargo update -p <crate> --precise <version>`).
- Pin every GitHub Action to a full commit SHA with the version in a comment (`uses: actions/checkout@<sha> # v7.0.1`), never to a tag. A tag can be moved to malicious code, and a SHA can't. Dependabot updates the SHA and the comment together.
- Prefer one action over several, and first-party ones (`actions/*`, the tool's own org) over community ones. A workflow action runs with the repo's token.
