# 0004: Shipping and updating the desktop app

- Status: accepted
- Scope: `.github/workflows/release-desktop.yml`, `apps/desktop/scripts/release`, `apps/desktop/scripts/macos-signing.ts`, `apps/desktop/build`, `apps/desktop/src/main/updates`, `apps/desktop/src/renderer/features/updates`

## Context

Installed copies have to learn about a new version and install it, or every
fix waits for users to download it again. Forge packages the app with
Squirrel (macOS ZIP, Windows installer) and deb and rpm on Linux, and
Electron's `autoUpdater` speaks Squirrel's feed formats. The rules in
`.agents/rules/local-first.md` still hold: no telemetry, no content leaves the
device, and the user can see and turn off what reaches the network.

An update installs code on every user's machine, so it is the most valuable
thing to forge. Squirrel.Mac refuses a build that isn't signed by the running
app's Developer ID. Squirrel.Windows checks no signature at all, and a build
job runs hundreds of dependencies beside whatever keys it holds.

Other Electron apps either run their own update server, use
`update.electronjs.org`, or serve electron-updater feeds from GitHub Releases
or a bucket; none of those we looked at sign their feeds.

## Decision

- **GitHub Releases is the only update server.** A release carries its
  installers plus static files, and installed copies read them from
  `<repo>/releases/latest/download/` (or, for test versions, from the release
  GitHub's API names). No server of ours sees update checks. The address and
  the release key are set at build time (`NOD_UPDATE_URL`,
  `NOD_UPDATE_PUBLIC_KEY`), so a fork updates from its own releases, and a
  build without them never checks.
- **The release key signs what installed copies trust.** `latest.json` names
  the version, the tag and the size and SHA-256 of every file, and
  `latest.json.sig` is its Ed25519 signature. The app ignores a manifest that
  the key didn't sign, that names another tag, or that isn't newer than the
  running version (semantic versioning, `@nod/core/updates`), since
  Squirrel.Mac would install an older release as readily as a newer one.
- **Windows updates are checked by Nod, not Squirrel.** Nod downloads
  `RELEASES` and the package, checks them against the signed manifest, and
  hands Squirrel.Windows the local folder. Squirrel never downloads anything.
- **macOS updates are checked by the feed and the signature.** Nod checks the
  Squirrel.Mac feed against the signed manifest and that it names the
  release's own ZIP; Squirrel.Mac downloads that ZIP itself and installs it
  only if it is signed by the same Developer ID. The ZIP's own hash isn't
  checked, so the published release's files must not change: releases are
  immutable once published.
- **Linux tells the user.** deb and rpm are installed by the package manager
  as root, so the app shows the new version and opens its release page.
- **Keys never meet dependencies.** Jobs that install dependencies hold no
  secrets; signing runs in separate jobs that install nothing: codesign,
  notarytool and our own `sign-macos.ts` for macOS, SignPath (whose key stays
  in its HSM) for Windows, and the manifest signature in `assemble`, which
  can't publish. What a job with dependencies makes after signing (the DMG,
  the ZIP, the Windows package and installer) is checked to hold exactly the
  signed app, plus Squirrel's pinned code on Windows, before it is signed or
  released.
- **Two release keys.** Builds trust the current key and the next one, kept
  offline, so a lost or leaked current key can be replaced without stranding
  installed copies.
- **Releases are tested before they're released.** Each release is published
  at once as a test release (`desktop-test-v<version>`, a prerelease with the
  same files), which copies with "Get test versions" on install through the
  real update path. The release stays a draft until a person publishes it.
- **Checks are on by default and can be turned off** in Settings → Updates.
  A check is a request for two small files, without cookies or credentials,
  a minute after launch and every six hours; with test versions on, also one
  request to GitHub's API.
- **Releases are reviewed by a person.** A signed tag on `main` starts the
  workflow, which checks both, and the `release` environment needs approval.
- **Every release is checkable.** It carries `SHA256SUMS`, and GitHub build
  provenance attestations once the repository is public.

## Consequences

- Losing both release keys means installed copies can never be updated
  again; a leaked key lets anyone who can also change release files ship code
  to Windows users until a release signed with the other key replaces it. The
  current key lives only in the `signing` environment and offline backups.
- The `signing` environment has no reviewer by default, so the tag ruleset and
  the workflow file are what keep its secrets to release runs; a compromised
  GitHub account defeats both.
- What gets built is still only as trustworthy as the dependencies that build
  it; the lockfile, the release age rule and few dependencies guard that.
- GitHub has one latest release per repository. Desktop releases have to stay
  it: anything else released here (the relay, the mobile app) is created with
  `--latest=false`, or stable copies stop finding new versions.
- While the repository is private, its release files can't be downloaded
  without a token, and SignPath Foundation won't sign it.
- On macOS, someone who can change a release's files before it is published
  could swap its ZIP for an older Nod signed with the same Developer ID, and
  copies would install it; the draft's file digests are compared with
  `SHA256SUMS` before publishing to catch that.
- Squirrel's own `Update.exe` and the launcher stubs it writes are not
  Authenticode-signed; their code (everything but resources) is checked
  against electron-winstaller's pinned binaries instead, as is the package
  `Setup.exe` carries inside it, and Windows doesn't check them after
  install.
- The update check reveals the user's network address and that they run Nod to
  GitHub, the same as downloading the app did.
