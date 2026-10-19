---
description: Strict TypeScript conventions.
globs: '*.ts, *.tsx, *.mts'
alwaysApply: false
---

- Never use `any`. Use `unknown` and narrow it, or reach for precise unions. `strict` is on; never loosen `tsconfig.json` to make an error go away.
- Never use type assertions: no `as T`, `<T>x`, `as const` or non-null `x!`. Declare the type (`const paths: Record<Key, string>`), use `satisfies` to check a literal, or narrow with a type guard or validation. `oxlint` and `scripts/check-no-type-assertions.ts` enforce this in `pnpm lint`.
- Prefer `type` over `interface`, and use `import type` for type-only imports. Use `interface` only to merge into a global declaration (`Window`).
- Type every IPC payload and result once, in `src/shared/ipc.ts`, and never redeclare the shape in main, preload or renderer.
- Treat data arriving over IPC, from disk, or from the network as `unknown` until it is validated.
- Write every relative import with its `.ts` extension (`./merge.ts`). Tests run the source directly on Node, which doesn't guess extensions. The linter enforces this.
- Use `node:` specifiers for Node built-ins (`node:path`, `node:fs/promises`).
- Run `pnpm typecheck` before claiming a change works.
- Use **pnpm**; this repo has `pnpm-lock.yaml`. Never run `npm install` or `yarn` here.
