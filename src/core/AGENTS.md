# Core (`src/core`)

The platform-neutral heart of the app: the data model, schema and migrations,
sync, conflict resolution and encryption logic. Other desktop OSes and future
mobile clients must run this code unchanged, so it is written to be lifted into
its own package later.

## Rules

- Never import `electron`, Node built-ins (`node:*` or bare `fs`, `path`, …),
  `src/main`, `src/preload` or `src/renderer`. The linter enforces this. The
  only exception is `node:test` and `node:assert` in `*.test.ts` files.
- Get platform capabilities (storage, filesystem, clock, network, key storage)
  through interfaces declared here and implemented in `src/main`. Core
  receives them as arguments; it never reaches for a global.
- Take cryptography from `core/crypto`, which wraps the audited noble and
  scure libraries so every client runs the same code. Never write a
  cryptographic primitive, and never use `node:crypto` or WebCrypto here.
  The one global these libraries read is `crypto.getRandomValues` for
  randomness; every target provides it (a mobile client needs its polyfill).
- Organize by domain (`core/<domain>/`), each with an `index.ts` barrel. Other
  layers import a domain only through its barrel.
- Keep it pure and deterministic where possible. Most of the code worth
  unit-testing lives here, so put tests next to it (`*.test.ts`).
- Treat the data format and sync protocol as contracts. Other devices may run an
  older version, so a schema change ships with a migration and must keep
  reading data written by the previous version.
- Follow `.agents/rules/local-first.md`. Most of its rules land here.
