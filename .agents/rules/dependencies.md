---
description: Every dependency ships code next to user data; add them rarely and keep the supply chain locked.
globs: 'package.json, pnpm-lock.yaml, pnpm-workspace.yaml'
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
