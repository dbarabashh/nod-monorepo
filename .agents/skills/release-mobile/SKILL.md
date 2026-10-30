---
name: release-mobile
description: Release a new version of the phone app (an Android APK on GitHub Releases, the iOS app through the App Store), and set up what the mobile release workflow needs (the Android keystore, variables, environments). Use when asked to release, ship, tag or publish a mobile version, or to change how mobile releases or in-app updates work.
---

# Release the mobile app

Paths are relative to the repository root. The decision behind this flow is
in `docs/decisions/0005-mobile-releases.md`; desktop releases are in the
`release-desktop` skill and share the release key.

A release is a signed tag `mobile-v<version>` on `main`. Pushing it runs
`.github/workflows/release-mobile.yml`, which tests, builds the Android APK,
signs it, writes the signed manifest and creates the release as a **draft**,
then waits for a person to approve publishing it.

## How a release is built

| Job             | Installs dependencies | Holds a secret           | Does                                                                    |
| --------------- | --------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `build-android` | yes                   | no                       | `expo prebuild`, `gradlew assembleRelease`, an unsigned APK             |
| `sign-android`  | no                    | the keystore             | `zipalign -P 16`, `apksigner`, checks the certificate, package, version |
| `assemble`      | no                    | the release key          | `latest.json`, `latest.json.sig`, `SHA256SUMS` (`assemble.mts assets`)  |
| `publish`       | no                    | none (`contents: write`) | provenance, the draft with `--latest=false`                             |
| `release`       | no                    | none (`contents: write`) | after approval, publishes the draft, never as latest                    |

The release holds `Nod-<version>.apk`, `latest.json`, `latest.json.sig` and
`SHA256SUMS`, and nothing else.

## How installed copies update (Android)

`src/lib/updates` asks GitHub's API for the list of releases (up to three
pages of 100), takes the newest published, non-prerelease `mobile-v…` one, and reads its
`latest.json` and signature. It ignores a manifest the release key didn't
sign, that names another release, or that isn't newer than the running
version. It downloads the APK, checks its size and SHA-256 against the
manifest, and hands it to Android's installer, which refuses it unless it is
signed by the installed app's certificate. iOS never checks.

A mobile release is never GitHub's latest release, which is where installed
desktop copies look for updates. The `release` job publishes with
`--latest=false` and fails if latest isn't a desktop release, and
`.github/workflows/keep-desktop-latest.yml` runs on every published or edited
release and makes the newest desktop release latest again if anything else
became it, for example a release published from the web form.

## Release

`main` takes changes only through pull requests, so a release is a pull
request first and a tag on its merge after, as for desktop.

1. List the changes under `## Unreleased` in `apps/mobile/CHANGELOG.md`, in
   words a user understands, and merge that into `main`.
2. On an up-to-date `main` with a clean tree, run
   `pnpm --filter nod-mobile release <major.minor.patch>` (each part below
   1000). It creates `release/mobile-<version>`, bumps
   `apps/mobile/package.json`, moves the Unreleased list under the version and
   commits `release mobile <version>` there. It pushes nothing.
3. Push the branch and open a pull request (the script prints both commands),
   and merge it once its checks pass.
4. On `main`, pulled to the merge, run
   `pnpm --filter nod-mobile release:tag <version>`, check the tag
   (`git verify-tag mobile-v<version>`), then
   `git push origin mobile-v<version>`.
5. Approve the `release` environment when the workflow asks.
6. When the draft appears, install its APK on an Android phone that runs the
   previous release, from Settings → Updates or by opening the APK, and on
   one without Nod. Check it opens, records and syncs.
7. Check the draft's files are the ones the workflow made:

   ```sh
   gh release view mobile-v<version> --json assets \
     --jq '.assets[] | "\(.digest | ltrimstr("sha256:"))  \(.name)"' | sort -k2 >/tmp/listed
   gh release download mobile-v<version> -p SHA256SUMS -O - | sort -k2 >/tmp/sums
   diff <(grep -v '  SHA256SUMS$' /tmp/listed) /tmp/sums && echo ok
   ```

8. Approve the `release` environment for the run's `release` job. It
   publishes the draft; installed copies find it at their next check.

9. iOS: archive the same version in Xcode (`pnpm ios` generates the project
   with `NOD_MOBILE_APP_ID` set), upload it to App Store Connect, and submit
   it for review. The App Store build number comes from the version.

If the draft is wrong, delete it and the tag, fix it, and release the next
patch version. Never replace a published file.

## One-time setup

1. **App ID.** Set the repository variable `NOD_MOBILE_APP_ID`
   (`app.hellonod.mobile` for this repository). Never change it after the
   first release.
2. **Android keystore.** On a trusted machine, outside the repository:

   ```sh
   keytool -genkeypair -v -keystore nod-release.keystore -alias nod \
     -keyalg RSA -keysize 4096 -validity 10000
   keytool -list -v -keystore nod-release.keystore -alias nod
   ```

   Put the SHA-256 certificate fingerprint, lowercase without colons, in the
   variable `NOD_ANDROID_CERT_SHA256`, and in the `signing` environment the
   secrets `ANDROID_KEYSTORE_BASE64` (`base64 -i nod-release.keystore`),
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and
   `ANDROID_KEY_PASSWORD`. Keep the keystore offline, encrypted, in two
   places; losing it strands every installed copy.

3. **Environments.** Add `mobile-v*` to the deployment tag rules of the
   `release` and `signing` environments. The `protect-tags` ruleset the
   `release-desktop` skill describes already keeps `mobile-v*` tags to admins.
4. **Google developer verification.** Register the developer account, the app
   ID and the certificate's fingerprint with Google before verification
   applies to sideloaded apps where Nod is used.
5. **App Store.** Create the app in App Store Connect with the same app ID,
   fill in App Privacy ("Data Not Collected"), declare its encryption, and
   request unlisted distribution after the first approval.

## Changing the flow

- The version lives in `apps/mobile/package.json` only; `app.config.js` reads
  it. The workflow refuses a tag that doesn't match it.
- A change to what the app reads from a release must stay readable by every
  installed version: they read the list of releases, `latest.json`,
  `latest.json.sig` and `Nod-<version>.apk`.
- `@nod/core/updates` holds the manifest and version rules both apps run.
  `scripts/release` holds what both apps' release scripts share (version
  rules, signing, the manifest, `prepareRelease`); they run without
  installing the workspace, so they can't import `@nod/core`. Keep the two in
  step, with tests.
- Pin every action to a commit SHA. Never give `build-android` a secret, or
  `sign-android` a dependency.
