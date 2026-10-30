---
name: release-desktop
description: Release a new version of the desktop app for macOS, Windows and Linux, and set up what the release workflow needs (signing, the release key, the environments). Use when asked to release, ship, tag or publish a desktop version, or to change how desktop releases or updates work.
---

# Release the desktop app

Paths are relative to the repository root. The decision behind this flow is in
`docs/decisions/0004-desktop-updates.md`.

A release is a signed tag `desktop-v<version>` on `main`. Pushing it runs
`.github/workflows/release-desktop.yml`, which tests, builds and signs on each
platform, publishes a **test release** `desktop-test-v<version>` at once, and
leaves the release itself as a **draft**. Installed copies with "Get test
versions" on update to the test release; everyone else updates only once a
person publishes the draft.

## How a release is built

Jobs that install dependencies never see a secret, and jobs that hold one
install nothing. A compromised dependency could change what is built, which
the lockfile, the release age rule and few dependencies guard against, but it
can't take or use the keys.

| Platform | Built and made on (no secrets)                   | Signed by (no dependencies)                              |
| -------- | ------------------------------------------------ | -------------------------------------------------------- |
| macOS    | `macos-15` (arm64), `macos-15-intel` (x64)       | `sign-macos.ts` + notarytool on the app, then on the DMG |
| Windows  | `windows-2025` (x64)                             | SignPath, on the app's binaries, then on `Setup.exe`     |
| Linux    | `ubuntu-24.04`, `ubuntu-24.04-arm` (deb and rpm) | nothing; `SHA256SUMS` and provenance cover them          |

macOS goes package → sign and notarize the `.app` → make the DMG and ZIP from
it (`electron-forge make --from-package`) → check both hold the app that was
signed (same CDHash) → sign and notarize the DMG. Windows goes package →
SignPath signs every `.exe`, `.dll` and `.node` → Squirrel makes the installer
from the signed app → `check-windows.ts` checks the package holds exactly the
signed files plus Squirrel's own code (`apps/desktop/build/squirrel-code.json`,
resources aside) → SignPath signs `Nod-<v>-Setup.exe`. The SignPath artifact
configurations are `apps/desktop/build/signpath/*.xml`.

The `assemble` job holds the release key and nothing that can publish. For the
release and the test release it writes the Squirrel.Mac feeds
(`RELEASES-darwin-<arch>.json`), `latest.json` (the version, the tag, and the
size and SHA-256 of every file), its Ed25519 signature `latest.json.sig`, and
`SHA256SUMS`, and refuses a file the release shouldn't contain. The `publish`
job, which holds no secret, attests build provenance when the repository is
public and creates the releases.

## How installed copies update

They read `latest.json` and its signature from
`<repo>/releases/latest/download/`, the newest published release that isn't a
prerelease, or, with test versions on, from the newest release or test
release GitHub's API lists. A manifest that isn't signed with the release key,
or names another tag, is ignored. Then:

- macOS: Nod checks that release's feed against the signed manifest, and that
  it names that release's own ZIP; Squirrel.Mac then installs the ZIP only if
  it is signed by the same Developer ID as the running app.
- Windows: Nod downloads `RELEASES` and the `.nupkg` itself, checks their size
  and SHA-256 against the signed manifest, and points Squirrel.Windows at the
  local folder, so Squirrel never downloads anything.
- Linux: Nod shows the version and opens the release page.

**Never mark another release on this repository as latest** (a relay release,
for example), or stable copies stop finding new versions.

## Release

`main` takes changes only through pull requests, so a release is a pull
request first and a tag on its merge after.

1. Make sure `apps/desktop/CHANGELOG.md` lists the changes under
   `## Unreleased`, in words a user understands, and that it is merged into
   `main`.
2. On an up-to-date `main` with a clean tree, run
   `pnpm --filter nod-desktop release <major.minor.patch>`. It checks the
   version is newer, creates `release/desktop-<version>`, moves the Unreleased
   list under the version, sets `apps/desktop/package.json` and commits
   `release desktop <version>` there. It pushes nothing.
3. Push the branch and open a pull request (the script prints both commands).
   Once its checks pass, merge it.
4. On `main`, pulled to the merge, run
   `pnpm --filter nod-desktop release:tag <version>`. It checks `main` carries
   that version and makes the signed tag `desktop-v<version>` on the merge.
   Check it (`git verify-tag desktop-v<version>`), then
   `git push origin desktop-v<version>` to start the release.
5. Approve the `release` environment when the workflow asks. SignPath may ask
   for its own approval of each signing request too.
6. When the test release appears, on a Mac and a Windows PC that run the
   previous version with Settings → Updates → "Get test versions" on, choose
   Check now, wait for Restart to update, restart, and confirm the new
   version. Check it opens, records and syncs. On Linux, install the test
   release's package over the previous one.
7. Check the draft's files are the ones the workflow made: every digest
   GitHub lists must match `SHA256SUMS` in the same release.

   ```sh
   gh release view desktop-v<version> --json assets \
     --jq '.assets[] | "\(.digest | ltrimstr("sha256:"))  \(.name)"' | sort -k2 >/tmp/listed
   gh release download desktop-v<version> -p SHA256SUMS -O - | sort -k2 >/tmp/sums
   diff <(grep -v '  SHA256SUMS$' /tmp/listed) /tmp/sums && echo ok
   ```

8. Publish the draft, leaving "Set as latest" on. Its files are the same as
   the test release's, byte for byte, except the feeds that name the tag.
   Installed copies find it within hours, and at once with Check now.

If the test release is wrong, delete it and the draft, delete the tag, fix
it, and release the next patch version. Never move a published tag or replace
a published file. Test releases can be deleted once their release is out.

All of this works only while the repository is public: a private one serves
no release files without a token, and SignPath Foundation signs only public
projects.

Prerelease versions (`1.3.0-beta.1`) are refused: Squirrel.Windows and the
Linux packages each rewrite them differently. Test releases take their place.

## One-time setup

1. **Release key.** Run `pnpm --filter nod-desktop release:key <folder>` on
   a trusted machine, with the folder outside the repository. It writes two
   private keys, `current.pem` and `next.pem`, and prints both public keys.
   Put the printed list in the repository variable `NOD_UPDATE_PUBLIC_KEY`,
   and `current.pem` in the `UPDATE_SIGNING_KEY` secret of the `signing`
   environment. Keep both files offline, encrypted, for example in your
   password manager, and delete the folder. Losing every copy of both keys
   means installed copies can never be updated again; a leaked key lets
   whoever can also change release files ship an update. If `current.pem`
   leaks or is lost, sign with `next.pem`, and build with a new list of
   `next` plus a fresh key.
2. **Environments** (Settings → Environments):
   - `release`: you as a required reviewer, deployment rule tags `desktop-v*`.
     It holds no secrets; approving it starts the build.
   - `signing`: deployment rule tags `desktop-v*`, and all secrets below.
     Without reviewers, a run reaches it only through the tag ruleset and the
     workflow file of the tagged commit; anyone who can push a `desktop-v*`
     tag with a changed workflow (your account, or an admin who bypasses the
     ruleset) gets the secrets. Add yourself as a reviewer too if that
     matters more than approving each signing step of a release.
3. **Branches, tags and releases.** Rulesets (Settings → Rules):
   - `protect-main`: `main` takes changes only through pull requests and
     can't be force-pushed or deleted.
   - `protect-tags`: every tag but `desktop-test-v*` can be created, moved or
     deleted only by an admin, so only you start a release.
   - `protect-test-tags`: `desktop-test-v*` tags can be created (the workflow
     creates one when it publishes the test release) but not moved or
     deleted.

   Turn on immutable releases (Settings → General → Releases). Keep every
   other workflow at `contents: read`.

4. **Repository variables:** `NOD_RELAY_URL` (as in the `build-macos` skill),
   `NOD_UPDATE_PUBLIC_KEY`, `NOD_BUNDLE_ID` (the macOS bundle ID; never
   change it after a release, or Squirrel.Mac refuses the update), and the SignPath `SIGNPATH_ORGANIZATION_ID`,
   `SIGNPATH_PROJECT_SLUG` and `SIGNPATH_SIGNING_POLICY_SLUG`.
5. **Secrets of `signing`:**
   - `UPDATE_SIGNING_KEY`: the release key from step 1.
   - `APPLE_CERTIFICATE_P12`: the "Developer ID Application" certificate with
     its private key and the Developer ID intermediate certificate, exported
     from Keychain Access as `.p12`, then `base64 -i cert.p12`. Without the
     intermediate, `codesign` fails with `errSecInternalComponent`.
   - `APPLE_CERTIFICATE_PASSWORD`: the password chosen on export.
   - `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`: an App Store
     Connect API key with the Developer role, for notarytool.
   - `SIGNPATH_API_TOKEN`: a SignPath CI user's token.
6. **SignPath.** Apply to SignPath Foundation for an open-source certificate.
   It needs the public repository, an OSI license, and a "Code signing
   policy" section on the project's home page that names SignPath.io and
   SignPath Foundation. Then, in SignPath, connect the GitHub repository as a
   trusted build system, create the project, a release signing policy, and
   the artifact configurations `app` and `installer` from
   `apps/desktop/build/signpath/app.xml` and `installer.xml`.

The workflow refuses a tag that isn't annotated, isn't signed with a key
GitHub can verify (add your signing key to your GitHub account), or points at
a commit that isn't on `main`.

## Changing the flow

- The version lives in `apps/desktop/package.json` only. The workflow refuses a
  tag that doesn't match it.
- File names come from the Forge makers and `productName`. `missingAssets` in
  `apps/desktop/scripts/release/assets.ts` lists what a release must contain;
  change it with the makers or the matrix, and run its tests.
- After electron-winstaller changes, re-pin Squirrel's code:
  `node apps/desktop/scripts/release/check-windows.ts pin node_modules/electron-winstaller/vendor`
  from the repository root, and review the diff of `squirrel-code.json`.
- Entitlements come from `apps/desktop/scripts/macos-signing.ts`, which both
  Forge's local signing and `sign-macos.ts` use. Give a binary the fewest that
  work.
- Pin every action to a commit SHA and Node to an exact version at least 7
  days old (`.agents/rules/dependencies.md`). Never give a job that installs
  dependencies a secret, or a job that holds one a dependency.
- A change to what the app reads from a release must stay readable by every
  version already installed: they read `latest.json`, `latest.json.sig` and
  the files the manifest names. Installed copies trust
  the keys they were built with, so a new key reaches them only through a
  release signed with a key they already trust.
