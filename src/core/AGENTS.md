# Core (`src/core`)

The platform-neutral heart of the app: the data model, schema and migrations,
sync, conflict resolution and encryption logic. Other desktop OSes and future
mobile clients must run this code unchanged, so it is written to be lifted into
its own package later.

## Rules

- Never import `electron`, `node:*`, `src/main`, `src/preload` or
  `src/renderer`. The linter enforces this.
- Get platform capabilities (storage, crypto primitives, filesystem, clock,
  network) through interfaces declared here and implemented in `src/main`. Core
  receives them as arguments; it never reaches for a global.
- Organize by domain (`core/<domain>/`), each with an `index.ts` barrel. Other
  layers import a domain only through its barrel.
- Keep it pure and deterministic where possible. This is the code most worth
  unit-testing, so put tests next to it (`*.test.ts`).
- Treat the data format and sync protocol as contracts. Other devices may run an
  older version, so a schema change ships with a migration and must keep
  reading data written by the previous version.
- Follow `.agents/rules/local-first.md`. Most of its rules land here.
