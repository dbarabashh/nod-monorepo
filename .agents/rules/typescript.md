---
description: Strict TypeScript conventions.
globs: '*.ts, *.tsx, *.mts'
alwaysApply: false
---

- Never use `any`. Use `unknown` and narrow it, or reach for precise unions. `strict` is on; never loosen a `tsconfig.json` to make an error go away.
- Never use type assertions: no `as T`, `<T>x`, `as const` or non-null `x!`. Declare the type (`const paths: Record<Key, string>`), use `satisfies` to check a literal, or narrow with a type guard or validation. `oxlint` and `scripts/check-no-type-assertions.ts` enforce this in `pnpm lint`.
- Prefer `type` over `interface`, and use `import type` for type-only imports. Use `interface` only to merge into a global declaration (`Window`).
- Treat data arriving over IPC, from disk, the network, a deep link, a QR code or a native module as `unknown` until it is validated.
- Type every desktop IPC payload and result once, in `apps/desktop/src/shared/ipc.ts`, and never redeclare the shape in main, preload or renderer.
- Write every relative import with its extension (`./merge.ts`, `./button.tsx`). Tests run the source directly on Node, which doesn't guess extensions. The linter enforces this. React Native platform files (`foo.ios.tsx`) can't be imported that way, so use `Platform.select` instead.
- Import another workspace package by its name and export (`@nod/core/meetings`), never by a relative path into its folder. Inside a package, use relative imports, never an alias such as `@/`.
- Use `node:` specifiers for Node built-ins, and only where Node runs: desktop main, scripts and tests. `packages/core` and the mobile app load no Node types outside their tests, because their code also runs on Hermes.
- Run `pnpm typecheck` before claiming a change works.
- Use **pnpm**; the repository has one `pnpm-lock.yaml` at the root. Never run `npm install`, `yarn` or `bun` here.
