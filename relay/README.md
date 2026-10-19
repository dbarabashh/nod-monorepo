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
- Everything except `pairing/` needs that token. The pairing area takes files
  up to 4 KB and forgets them after a day.
- Back up `RELAY_DATA` if you like; it holds only ciphertext.

To offer your relay in Settings → Sync without anyone typing its address,
build the app with it. Each user still turns it on themselves:

```sh
NOD_RELAY_URL=https://relay.example.com pnpm make
```

Without it, each user picks a folder or a relay in Settings → Sync.
