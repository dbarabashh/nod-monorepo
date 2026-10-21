---
description: Strict TypeScript conventions.
globs: '*.ts, *.tsx, *.mts'
alwaysApply: false
---

- Never use `any`. Use `unknown` and narrow it, or reach for precise unions. `strict` is on; never loosen `tsconfig.json` to make an error go away.
- Never use type assertions: no `as T`, `<T>x`, `as const` or non-null `x!`. Declare the type (`const paths: Record<Key, string>`), use `satisfies` to check a literal, or narrow with a type guard or validation. `oxlint` and `scripts/check-no-type-assertions.mts` enforce this in `pnpm lint`.
- Prefer `type` over `interface`, and use `import type` for type-only imports.
- Treat data arriving from disk, the network, a deep link, a QR code or a native module as `unknown` until it is validated.
- Write every relative import with its extension (`./merge.ts`, `./button.tsx`). Tests run the source directly on Node, which doesn't guess extensions. The linter enforces this. Platform-specific files (`foo.ios.tsx`) can't be imported that way, so use `Platform.select` instead of them.
- Use relative imports, not the `@/` alias, so the same file runs under Metro and under `node --test`.
- Use `node:` specifiers for Node built-ins, and only in scripts and tests. App code runs on Hermes, which has no Node, so `tsconfig.json` loads no Node types; `tsconfig.node.json` checks scripts and tests with them.
- Run `pnpm typecheck` before claiming a change works.
- Use **pnpm**; this repo has `pnpm-lock.yaml`. Add packages with `pnpm exec expo install <name>` so versions match the SDK. Never run `npm install`, `yarn` or `bun` here.
