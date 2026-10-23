# Sync relay

An optional server that devices can sync meetings through when they don't
share a folder. It stores encrypted files per vault and can't read them; see
`docs/decisions/0001-sync.md` for the design.

```sh
PORT=8787 RELAY_DATA=/var/lib/nod-relay node relay/server.ts
```

Put it behind HTTPS (a reverse proxy such as Caddy or nginx). The app only
accepts `https://` relays, except `http://localhost` for testing.

- A vault is registered by its first device with a token derived from the
  vault key; the relay keeps only a hash of it. The vault id must be the first
  32 hex characters of that hash, so only the key's holder can register it.
- Every file needs that token. Relays from before pairing was removed may
  hold a leftover `<vault>/files/pairing/` folder in `RELAY_DATA`; delete it.
- Back up `RELAY_DATA` if you like; it holds only ciphertext.

To offer your relay in Settings → Sync without anyone typing its address,
build the app with it. Each user still turns it on themselves:

```sh
NOD_RELAY_URL=https://relay.example.com pnpm make
```

Without it, each user picks a folder or a relay in Settings → Sync.

## On Vercel

`relay/vercel` is the relay as a Vercel Function over a private Vercel Blob
store. It serves the same file API the app syncs through. It keeps no secrets:
a vault id is a hash of the token derived from the vault key, so the function
only checks that the token hashes to the id, and nobody can claim a vault
first. It reaches the
store with the short-lived OIDC token Vercel gives it, not a stored token.

Each vault keeps an index of its files, so a device that polls costs one small
read rather than a listing. Writes update the index with conditional writes and
retry on conflict. Only meeting, note, shares and closing files are accepted.
Per vault: files up to
4 MB (the platform's request limit), 10,000 files, 3,600 writes and deletes an
hour, and 32 MB of space on the first day, growing by 32 MB a day up to
512 MB. Only one write or delete of a file runs at a time; a second gets 409. A
reservation counts as abandoned after 2 minutes, so host the relay only where
a request can't run that long (`maxDuration` is 30 s). Across the relay, since vault
ids cost nothing to make: 300 new vaults an hour, and 3 an hour from one
network (/24 or /64, kept only as an hourly hash keyed with
`RELAY_ADDRESS_KEY`). A write
that never finished is settled later against what storage holds.

```sh
cd relay/vercel
pnpm install --ignore-workspace
vercel link
vercel blob create-store <name> --access private --region <region>
vercel env rm BLOB_READ_WRITE_TOKEN   # use OIDC instead of a stored token
vercel env add BLOB_STORE_ID production
vercel env add VERCEL_BLOB_RETRIES production   # 2
vercel env add RELAY_ADDRESS_KEY production     # 32 random bytes, hex
vercel deploy --prod
vercel domains add <sync domain>
```

Then, in the project's firewall: deny requests whose host isn't the sync
domain (the `*.vercel.app` aliases reach the same store), and rate-limit per
IP: all requests other than `GET` (300 a minute), `GET` (600 a minute), and
file downloads, `GET` on paths with `/files/devices/` (60 a minute). Set a spend limit that pauses the project, and
rotate the store's read-write token, which the app never needs.
