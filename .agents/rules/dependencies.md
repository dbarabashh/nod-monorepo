---
description: Every dependency ships code next to user data; add them rarely and keep the supply chain locked.
globs: 'package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .github/**'
alwaysApply: false
---

- Prefer Electron, Node and Web platform APIs, or a dependency already in the tree, over adding a package. Each new dependency is code with access to user data.
- Before adding a package, check what it pulls in (`pnpm why`, the size of its dependency tree), its maintenance, and whether it runs install scripts. Say why it is needed.
- Keep `dependencies` minimal, because they ship inside the app. Build and dev tooling goes in `devDependencies`.
- Allow install scripts only by listing the package under `allowBuilds` in `pnpm-workspace.yaml`, and only after reading what the script does.
- Always commit `pnpm-lock.yaml`. Install with the frozen lockfile in CI, and never hand-edit the lockfile.
- Don't upgrade to a version published only days ago unless it fixes a security issue. Fresh releases are where hijacked packages land.
- Never add a package that phones home, collects telemetry, or loads code from the network at runtime.
- Never load remote code in the app (CDN scripts, remote modules, `eval` of fetched text). Everything that runs is bundled at build time.
- Dependabot (`.github/dependabot.yml`) opens weekly update PRs and waits 7 days after a release (14 days for majors) before proposing it. Review each PR like a new dependency: read the changelog, and run `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm make`. Never merge one only because CI is green.
- Electron and Forge packages update together in one Dependabot group. An Electron major changes the bundled Node and Chromium, so check the Electron release notes and rebuild native modules before merging.
- Pin every GitHub Action to a full commit SHA with the version in a comment (`uses: actions/checkout@<sha> # v7.0.1`), never to a tag. A tag can be moved to malicious code, and a SHA can't. Dependabot updates the SHA and the comment together.
- Prefer one action over several, and first-party ones (`actions/*`, the tool's own org) over community ones. A workflow action runs with the repo's token.
