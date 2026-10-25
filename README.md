# Nod

A local-first meeting notetaker. Meetings stay on your devices, encrypted, and
sync between them end to end encrypted. Audio is transcribed on the device and
never stored.

- `apps/desktop`: the app for macOS, Windows and Linux (Electron)
- `apps/mobile`: the app for iOS and Android (Expo)
- `packages/core`: the data model, sync and crypto both apps share
- `packages/automerge-native`: Automerge for mobile, on a Rust backend
- `docs/decisions`: why things are built the way they are

## Develop

Requires Node 24+, pnpm and Rust (`rustup`). The mobile app also needs Xcode,
or JDK 17 and the Android SDK; see `apps/mobile/README.md`.

```sh
pnpm install
pnpm desktop     # the desktop app in dev mode
pnpm ios         # or: pnpm android
pnpm typecheck && pnpm lint && pnpm test
```

Contributor and agent rules live in `AGENTS.md` and `.agents/`.

## License

Nod is licensed under the [Apache License 2.0](LICENSE), with one exception:
the sync relay in `apps/relay` is licensed under the
[GNU Affero General Public License v3.0 only](apps/relay/LICENSE). If you
run a modified relay as a service, you must offer its source to the people who
use it.

| Path                        | License       |
| --------------------------- | ------------- |
| `apps/desktop`              | Apache-2.0    |
| `apps/relay`                | AGPL-3.0-only |
| `apps/mobile`               | Apache-2.0    |
| `packages/core`             | Apache-2.0    |
| `packages/automerge-native` | Apache-2.0    |

Folders don't decide a license on their own. [REUSE.toml](REUSE.toml) states
the license of every file, and each relay file carries an SPDX license header
naming AGPL-3.0-only. A built relay combines the
relay with `@nod/core` (Apache-2.0) and is licensed as a whole under the AGPL;
its build writes the banner, the license texts and the third-party notices next
to it. License texts are in [LICENSES](LICENSES).

Copyright 2026 Dima Barabash. The name "Nod" and its logo are not covered by these licenses; see [NOTICE](NOTICE).

Pull requests aren't accepted; issues are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md).
