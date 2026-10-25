# Sync relay (`apps/relay`)

`@nod/relay` is the optional sync relay devices can use when they don't share a
folder: a small HTTP server that stores encrypted files per vault and can't
read them. `docs/decisions/0001-sync.md` and `docs/decisions/0003-sharing.md`
describe the protocol; `README.md` here describes running and deploying it.

It is the one part of the repository licensed under AGPL-3.0-only (`LICENSE`).
Every file starts with the two SPDX lines the others carry, and no app imports
this package outside tests, so the AGPL stays here.

```
server.ts       the self-hosted relay: one Node process over a directory
vercel/         the hosted relay: a Vercel Function over private Vercel Blob,
                with its own lockfile, installed and typechecked on its own
build.ts        bundles both into dist/ (ignored by git) with the license
                banner, LICENSE files, NOTICE and THIRD_PARTY_NOTICES
deploy.ts       deploys dist/vercel to the Vercel project linked there
```

```sh
pnpm build           # dist/server.js and dist/vercel
pnpm deploy:vercel   # build, then deploy dist/vercel (not `pnpm deploy`,
                     # which is pnpm's own command)
pnpm test            # node:test over *.test.ts and vercel/*.test.ts
pnpm typecheck
pnpm lint
```

Protocol rules (vault ids, team access lists, signed requests, limits) come
from `@nod/core/sharing/relay`, shared with the clients; change them there and
keep both relays in step. Both relays serve `GET /source`, the address of their
source code from `RELAY_SOURCE_URL`, which AGPL section 13 asks a modified,
network-facing copy to offer its users.

Rules: the repository-wide ones in the root `AGENTS.md`.
