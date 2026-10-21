# Core (`packages/core`, `@nod/core`)

The platform-neutral heart of Nod: the data model, schema and migrations, sync,
conflict resolution and encryption logic. The desktop app (Electron main on
Node) and the mobile app (Hermes) run this code unchanged, so it ships as
TypeScript source with no build step: each app's bundler compiles it, and
`node --test` runs it directly.

## Layout

```
src/<domain>/        one domain each, with an index.ts barrel
package.json         "exports" maps @nod/core/<domain> to src/<domain>/index.ts
tsconfig.json        source, with no Node types
tsconfig.test.json   tests, with Node types for node:test and node:assert
```

## Rules

- Never import `electron`, React, React Native, Expo, Node built-ins (`node:*`
  or bare `fs`, `path`, …) or an app. The linter enforces this. The only
  exception is `node:test` and `node:assert` in `*.test.ts` files.
- Get platform capabilities (storage, filesystem, clock, network, key storage)
  through interfaces declared here and implemented by each app. Core receives
  them as arguments; it never reaches for a global.
- Use `@automerge/automerge` only through what `src/meetings/document.ts` does
  today. Mobile runs it on `@nod/automerge-native`, which implements the
  backend methods this code needs and refuses the rest; a new Automerge
  feature here needs a test there first.
- Take cryptography from `src/crypto`, which wraps the audited noble and scure
  libraries so every client runs the same code. Never write a cryptographic
  primitive, and never use `node:crypto` or WebCrypto here. The one global these
  libraries read is `crypto.getRandomValues` for randomness; every target
  provides it (the mobile app through a polyfill).
- Organize by domain (`src/<domain>/`), each with an `index.ts` barrel listed in
  `package.json` `exports`. Apps import a domain only as `@nod/core/<domain>`.
- Keep it pure and deterministic where possible. Most of the code worth
  unit-testing lives here, so put tests next to it (`*.test.ts`).
- Treat the data format and sync protocol as contracts. Other devices may run an
  older version, so a schema change ships with a migration and must keep
  reading data written by the previous version. Read
  `docs/decisions/0001-sync.md` first.
- Some domains serve one app today (`meeting-detection`, `mcp` for desktop).
  They stay here because they are platform-neutral logic, not because both apps
  use them.
- Follow `.agents/rules/local-first.md`. Most of its rules land here.
