# Sync relay

An optional server that devices can sync meetings and shared notes through
when they don't share a folder. It stores encrypted files per vault and can't
read them; see `docs/decisions/0001-sync.md` for the design and
`docs/decisions/0003-sharing.md` for team vaults.

```sh
pnpm --filter @nod/relay build
PORT=8787 RELAY_DATA=/var/lib/nod-relay \
  RELAY_SOURCE_URL=<address of this relay's source> \
  node apps/relay/dist/server.js
```

`apps/relay/dist/server.js` is one self-contained file that runs with plain `node`
(24 or later) and nothing installed, so it can be copied to the server on its
own. From the workspace, `node apps/relay/server.ts` runs the same source
directly.

Put it behind HTTPS (a reverse proxy such as Caddy or nginx). The app only
accepts `https://` relays, except `http://localhost` for testing. A signed
request to a team vault names the public host, so the relay must know it:
either set `RELAY_HOST` to the public host (with its port, if any), or make
the proxy pass the original `Host` header through (nginx:
`proxy_set_header Host $http_host;`; Caddy does by default). Without either,
`proxy_pass` rewrites `Host` to the upstream address and every signed request
fails with 401.

The standalone relay is meant for people you know. Run one process per
`RELAY_DATA`: it orders the changes to a vault in memory, so two processes on
the same directory can corrupt a team's list. It sees only the proxy's
address, so per-client limits belong at the proxy: cap request bodies at
16 MB (256 KB on `/acl`, 8 KB on `/invites`), rate-limit requests per IP, and
limit connections. On its own it keeps per vault at most 10,000 files and
1 GB, 60 new vaults an hour across the relay (counted in memory, so a
restart starts the hour again), and for team vaults the same write, record
and nonce limits as the hosted relay (below). Token vaults have no hourly
write limit of their own, so the proxy's rate limit is what bounds them.
Vault ids are lowercase hex only, so no two spellings name one folder on a
filesystem that ignores case.

## Token vaults

A personal or one-to-one vault is a **token vault**.

- A vault is registered by its first device with a token derived from the
  vault key; the relay keeps only a hash of it. The vault id must be the first
  32 hex characters of that hash, so only the key's holder can register it.
- Every file needs that token. Only the files a vault has are stored:
  `devices/<d>/meetings/<id>.bin`, `devices/<d>/notes/<id>.bin`,
  `devices/<d>/closed.json` and `devices/<d>/shares.bin`; any other path is
  refused with 400. Relays from before pairing was removed may hold a
  leftover `<vault>/files/pairing/` folder in `RELAY_DATA`; delete it.
- Back up `RELAY_DATA` if you like; it holds only ciphertext.

## Team vaults

A team vault has no token. It is registered by posting its **root record** to
`PUT /v1/vaults/<id>/acl`, where `<id>` is the first 16 bytes of the record's
hash, and every request to it carries
`Authorization: Nod-Identity <identity> <time> <nonce> <signature>`: the
member's Ed25519 signature over the relay host, the method, the path with its
query, the vault id, the SHA-256 of the body, the time and the nonce. The
relay checks the signature and the identity's role in the team's access list,
which it validates with the same module the app runs
(`@nod/core/sharing/relay`, bundled into both relays). The rules below (who
may append which record, write or delete which file, and how nonces and
invite files are kept) live once in that module, so both relays and the app's
test relay answer alike; each relay adds only its storage and quotas. A vault
is one kind or the other: a token on a team vault's routes and an identity on
a token vault's routes are both refused.

| route                    | who                     | what                                                                  |
| ------------------------ | ----------------------- | --------------------------------------------------------------------- |
| `PUT /`                  | members                 | nothing (the app's register call); 204, and it claims no nonce        |
| `PUT /acl`               | the owner (root record) | registers the team                                                    |
| `PUT /acl`               | members                 | appends a record that names the current head as `prev`; 409 otherwise |
| `PUT /acl`               | anyone with an invite   | appends a `requestJoin` or `inviteJoin` record, which follows nothing |
| `GET /acl`               | members                 | the list as a JSON array, with an `etag`; 304 on `if-none-match`      |
| `GET /acl/<record id>`   | the requester           | `{ "status": "pending" \| "accepted" \| "declined" }`, else 404       |
| `PUT /invites/<file id>` | owners and admins       | stores an invite file; the id is the first 16 bytes of its hash       |
| `GET /invites/<file id>` | anyone                  | the sealed invite file, which opens only with the key in the link     |
| `GET /files?prefix=`     | members                 | the listing                                                           |
| `GET /files/<path>`      | members                 | a file                                                                |
| `PUT /files/<path>`      | writers, admins, owners | a version 2 file; `members.bin` only owners and admins                |
| `DELETE /files/<path>`   | the folder’s identity   | removes a file; owners and admins too, once that identity left        |

Routes are under `/v1/vaults/<id>`. Only `devices/<d>/notes/<id>.bin` and
`devices/<d>/members.bin` exist in a team vault, where `<d>` is 64 lowercase
hex characters (a device's blinded id); meetings, `closed.json` and
`shares.bin` are refused with 400. A written file must be a version 2 signed
file whose header names the requester as publisher (403 otherwise) and the
list's current key generation (409 otherwise), so nothing is sealed under a
retired key. The relay reads the header only, never the content.

Each device folder `devices/<d>/` is bound to the first identity that writes
into it, for the life of the vault; any other identity is refused there
(403), and a relay that lost its bindings rebuilds them from the headers of
the files it holds. A file is deleted by the identity bound to its folder,
or by an owner or admin once that identity is no longer in the list.

Every record is checked by the validator against the list as it stands and
refused with 400 and the reason otherwise. A join record is accepted from a
non-member only with a valid join proof for a live invite, at most one
pending per identity and invite, and at most 32 pending per invite.

Each record on the list counts as a write, each identity puts at most 6
records on a list an hour (owners and admins 120), and at most 32 people join
through one invite an hour, since every joiner can be a fresh identity; past
that, 429 with `x-relay-refusal: writes`. A team has at most 500 members
(507 beyond), so a key rotation, which wraps the key for every member, still
fits in one record. A list grows to at most 8 MB; its last 1 MB takes only an
owner's or admin's `accountsRemove`, `keyChange`, `permissionChanges`,
`inviteRevoke` or `ownerChange`, and the last 512 KB of that only the
owner's (507 for anything else), so a list that others filled can still lose
them and rotate its key, and an admin who filled it can still be removed by
the owner. Those repairs also don't count against the vault's hourly writes,
only against their author's records. Writing an invite file counts as a
write too.

Signed requests are accepted within 5 minutes of the relay's clock. The
relay remembers the nonce of every request other than `GET` that it acts on,
once the request is authorized and its write counted, and refuses a
repeated one with 403; a replayed `GET` only returns ciphertext its sender
already captured, and a refused request, including one the hourly limits
refused, leaves no nonce behind. A nonce is kept until the request's
own time plus the window has passed (or the relay's, whichever is later), so
a request stamped ahead of the relay's clock can't be replayed once the
relay forgot it. At most 1,200 nonces are live per vault (four times what the
write limit allows in one window), and at most 150 from one identity, so one
member can't make every writer wait; the last 32 of them take only an
owner's or admin's repair, and the last 16 of those only the owner's, so
members, or an admin, who filled the rest can still be removed. Beyond that,
writes get 429 with `x-relay-refusal: writes`, which leaves the client
reading, until some expire. A `DELETE` or the register call with a body is
refused with 413, any other method with 405, and a file `PUT` from an
identity the list doesn't name with 403 before its body is read. Team
registration counts against the new vaults an hour like any other vault.
Per team vault the relay keeps at most 8 invite files of up to 8 KB, each
for 7 days, and refuses a ninth with 507; a list grows to at most 8 MB
(records are at most 256 KB each).

What the relay stores for a team vault, all of it readable without a key: the
list (`acl.json`), the device folder bindings (the standalone relay in
`team.json`, the hosted one in its index), the invite file times
(`team.json`), the live nonces (the standalone relay in `team.json`, so a
restart forgets none; the hosted one in `nonces.json`, rewritten by every
non-`GET` request it acts on), this hour's write counts (the standalone relay
in `team.json`, the hosted one in its index), the invite files and the sealed
files. It sees identities, roles and file sizes, never a key, a name or a
note.

## Building

Both relays use `@nod/core/sharing/relay`, the same validator the apps run,
and import it from the workspace. Neither runs inside the workspace, so

```sh
pnpm --filter @nod/relay build
```

bundles them into `apps/relay/dist` (ignored by git): `server.js` for self-hosting,
and `vercel/`, the folder the hosted relay deploys from. It refuses to finish
if a bundle pulls in Automerge or wasm, or imports anything at run time
beyond what node ships (and `@vercel/blob` for the hosted one). The tests run
the sources, so they need no build.

To offer your relay in Settings → Sync without anyone typing its address,
build the app with it. Each user still turns it on themselves:

```sh
NOD_RELAY_URL=https://relay.example.com pnpm make
```

Without it, each user picks a folder or a relay in Settings → Sync.

## On Vercel

`apps/relay/vercel` is the relay as a Vercel Function over a private Vercel Blob
store. It serves the same API, for token and team vaults. It keeps no
secrets: a token vault id is a hash of the token derived from the vault key,
so the function only checks that the token hashes to the id, and a team vault
id is a hash of its signed root record. Nobody can claim a vault first. It
reaches the store with the short-lived OIDC token Vercel gives it, not a
stored token.

Each vault keeps an index of its files, so a device that polls costs one small
read rather than a listing. Writes update the index with conditional writes and
retry on conflict; a team's list is appended the same way, so two admins
acting at once produce one winner and one 409. Per vault: files up to
4 MB (the platform's request limit), 10,000 files, 3,600 writes and deletes an
hour, and 32 MB of space on the first day, growing by 32 MB a day up to
512 MB. Only one write or delete of a file runs at a time; a second gets 409. A
reservation counts as abandoned after 2 minutes, so host the relay only where
a request can't run that long (`maxDuration` is 30 s). In a team vault each
identity takes at most 900 of the vault's 3,600 writes an hour, and a write is
checked again against the list right before it is stored, so a file sealed
under a key that was rotated meanwhile is refused with 409. Across the relay,
since vault ids cost nothing to make: 300 new vaults an hour, 3 an hour from
one network (/24 or /48) and 10 an hour from one wider network (/16 or /32),
each kept only as an hourly hash keyed with `RELAY_ADDRESS_KEY`. Someone with
addresses in many /32s (or many IPv4 /16s) can still take the hour's 300 and
hold off new vaults, including new teams, until the next hour; existing vaults
are unaffected, and the firewall's per-IP limits are the next line. A write
that never finished is settled later against what storage holds.

Each function instance keeps up to 64 MB of teams' lists in memory, dropping
the least recently used, and remembers for 10 seconds that a vault id has no
team or no invite files, so repeated requests for one cost no read. A team
registered meanwhile on another instance may answer 404 there for that long
(appending to the list always looks again), and so may an invite file stored
meanwhile through another instance.

```sh
pnpm --filter @nod/relay build   # writes apps/relay/dist/vercel
cd apps/relay/dist/vercel
vercel link
vercel blob create-store <name> --access private --region <region>
vercel env rm BLOB_READ_WRITE_TOKEN   # use OIDC instead of a stored token
vercel env add BLOB_STORE_ID production
vercel env add VERCEL_BLOB_RETRIES production   # 2
vercel env add RELAY_ADDRESS_KEY production     # 32 random bytes, hex
vercel env add RELAY_SOURCE_URL production      # where this relay's source is; see License
vercel deploy --prod
vercel domains add <sync domain>
```

Once the folder is linked and set up, every later deploy is one command from
the repository root. It builds both relays and deploys this folder to the
linked project with the CLI's telemetry off:

```sh
pnpm --filter @nod/relay deploy:vercel
```

On the first deploy, check a signed request against the custom domain before
offering the relay: the function verifies the signature over the host and the
path with its query exactly as the app sent them, so it must see the public
host (not a `*.vercel.app` alias) and the byte-identical query string after
the `/v1/:path*` rewrite. A team vault registration or `GET /acl` that
answers 401 means the host or the query reached the function changed.

Then, in the project's firewall: deny requests whose host isn't the sync
domain (the `*.vercel.app` aliases reach the same store; a signed request
names the host, so a request through an alias fails its signature anyway),
and rate-limit per IP: all requests other than `GET` (300 a minute), `GET`
(600 a minute), and file downloads, `GET` on paths with `/files/devices/`
(60 a minute). Set a spend limit that pauses the project, and rotate the
store's read-write token, which the app never needs.

## License

The relay is licensed under the GNU Affero General Public License v3.0 only
(`LICENSE` in this folder), and every file here says so in an SPDX header. If
you run a modified relay as a service, offer its source to the people who use
it.

A build combines the relay with code from `@nod/core`, which is Apache-2.0, and
with third-party packages. `build.ts` marks each bundle with a license
banner and writes, beside `dist/server.js` and in `dist/vercel`: `LICENSE`
(AGPL), `LICENSE-Apache-2.0`, `NOTICE`, and `THIRD_PARTY_NOTICES` for the
packages the bundle contains. Copy them along with the bundle. A new file in
this folder starts with the same two SPDX lines.

Both relays answer `GET /source` with a short notice naming the license and
the address in `RELAY_SOURCE_URL`, which is how a relay you run for other
people offers them its source, as section 13 of the AGPL asks of a modified
copy. Point it at the exact source you run, including your changes. Without
the variable `/source` answers 404. The self-hosted relay refuses to start on
a value that isn't an http(s) address; the hosted function logs the mistake
and keeps serving sync without the notice, so a typo can't take sync down.
The Nod apps don't yet show this address to the people using a relay, so tell
them where it is too, for example on the page that gives out the relay's
address.
