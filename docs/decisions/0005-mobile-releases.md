# 0005: Shipping and updating the mobile app

- Status: accepted
- Scope: `.github/workflows/release-mobile.yml`, `apps/mobile/scripts/release`, `apps/mobile/app.config.js`, `apps/mobile/plugins/with-unsigned-release.js`, `apps/mobile/src/lib/updates`, `packages/core/src/updates`, `scripts/release`

## Context

The phone app has to reach people without a store listing they would have to
find, from a QR code on the website, and it has to update itself the way the
desktop app does (`0004-desktop-updates.md`). The two platforms allow very
different things. Android installs an APK from anywhere once the person
allows it, and installs an update only over an app signed with the same
certificate. iOS installs apps for the public only through the App Store;
TestFlight builds expire after 90 days, ad hoc builds reach 100 registered
devices, and other routes exist only in the EU.

The rules in `.agents/rules/local-first.md` hold here as on desktop: no
telemetry, nothing about the person leaves the phone, and they can see and
turn off what reaches the network.

## Decision

- **Android ships as an APK on GitHub Releases.** A signed tag
  `mobile-v<version>` on `main` runs `release-mobile.yml`, which builds one
  APK for arm64-v8a, armeabi-v7a and x86_64, signs it, and creates the
  release as a draft. Once a person has tried its APK and approves the
  `release` environment, the workflow publishes it.
- **iOS ships through the App Store as an unlisted app.** It isn't in search
  or the charts; the QR code links to it. App Store review applies. The app
  never downloads code on iOS.
- **The release key signs what phones trust, as on desktop.** `latest.json`
  names the version, the tag, and the size and SHA-256 of the APK, and
  `latest.json.sig` is its Ed25519 signature by the same release key. A
  manifest names its app in its tag (`mobile-v…` or `desktop-v…`), and each
  app refuses the other's, so sharing the key never lets one stand for the
  other.
- **Phones find their release in GitHub's list of releases.** GitHub has one
  latest release per repository and the desktop app updates from it, so a
  phone release is never marked latest: the workflow publishes it with
  `--latest=false` and fails if latest isn't a desktop release, and
  `keep-desktop-latest.yml` makes the newest desktop release latest again
  after any release is published or edited, from the web form included. The
  app reads the newest published, non-prerelease `mobile-v…` release from
  GitHub's API.
- **The app checks before Android's installer sees anything.** It verifies the
  manifest's signature with `@nod/core/updates` (noble, RFC 8032 rules), that
  it names the release it was found under and a newer version, then downloads
  the APK and checks its size and SHA-256 against the manifest before handing
  it to Android's installer. Android then refuses an APK not signed with the
  installed app's certificate.
- **The release certificate never meets a dependency.** Gradle builds the APK
  unsigned (`with-unsigned-release.js` overrides the template's debug signing
  of release builds), and a job that installs nothing aligns and signs it
  with the runner's `zipalign` and `apksigner`, then checks the certificate's
  SHA-256 against `NOD_ANDROID_CERT_SHA256` and the package and version with
  `aapt2`.
- **One app ID on both platforms**, `NOD_MOBILE_APP_ID`, set at build time so a
  fork builds its own. The version comes from `apps/mobile/package.json`, and
  the build number both stores order builds by is derived from it (1.2.3 is
  1002003), so each part stays below 1000.
- **Checks are on by default and can be turned off** in Settings → Updates. A
  check is a request to GitHub's API (up to three pages of the list), and two
  more for the manifest when a newer release exists, without cookies or
  credentials: a minute after launch, then when the app comes back once six
  hours have passed, or an hour after a check failed. A new version found while
  a meeting records waits in Settings instead of interrupting it. Builds
  without an update source (`NOD_UPDATE_URL` and `NOD_UPDATE_PUBLIC_KEY`) never
  check and never ask to install packages.

## Consequences

- Losing the Android keystore means installed copies can never be updated
  again; people would have to uninstall, losing what isn't synced, and install
  anew. It lives in the `signing` environment and offline backups only.
- Google is rolling out developer verification for apps installed outside
  Play on certified devices. The app ID and signing certificate have to be
  registered with Google before it applies where Nod is used, or new installs
  stop working.
- Android asks the person once to allow installs from Nod (and once from
  their browser for the first install). Updates still need their tap in
  Android's installer.
- An update check tells GitHub the phone's network address and that it runs
  Nod, as downloading the APK did.
- GitHub allows 60 unauthenticated API requests an hour per address, and a
  phone network can put many phones behind one. A check that hits the limit
  fails and is tried again an hour later; the update it would have found
  waits for the next check.
- A release published from GitHub's web form with "Set as the latest
  release" left on is latest for the seconds `keep-desktop-latest.yml` takes
  to run; a desktop copy that checks in that window ignores the phone's
  manifest and finds its update at the next check.
- The app looks for its release on the first page of GitHub's list that has
  one. A patch for an older version created after a newer release could be
  missed until that newer one is published; release patches in version order.
- Whoever controls the GitHub account can't get code installed without the
  release key, but can stop updates, for example with a newest `mobile-v`
  release whose manifest doesn't verify: every check then fails.
- The release and test-release scheme of desktop isn't repeated: a draft is
  installed by hand from the release page before it is published.
- Both apps run the version and manifest rules of `@nod/core/updates`. The
  release jobs run without installing the workspace, so the scripts that write
  a release use `scripts/release` (Node's crypto, the same version rules), and
  the two copies are kept in step by their tests.
