const { version } = require('./package.json');

// Valid both as an Android application ID and an iOS bundle ID. Neither can
// change after the first release: Android refuses the update and iOS sees
// another app.
const appIdPattern = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;
const releasesPattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases$/;
const versionPattern = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;

// Android and iOS order builds by an integer that must grow with each
// release, so it comes from the version: 1.2.3 is 1002003.
function buildNumber() {
  const match = versionPattern.exec(version);
  if (!match) {
    throw new Error(
      `package.json version ${version} must be major.minor.patch, each below 1000.`,
    );
  }
  return (
    Number(match[1]) * 1_000_000 + Number(match[2]) * 1_000 + Number(match[3])
  );
}

function updates() {
  const releases = process.env.NOD_UPDATE_URL;
  const publicKey = process.env.NOD_UPDATE_PUBLIC_KEY;
  if (!releases && !publicKey) {
    return null;
  }
  if (!releases || !releasesPattern.test(releases) || !publicKey) {
    throw new Error(
      'Set NOD_UPDATE_URL to a GitHub releases page and NOD_UPDATE_PUBLIC_KEY to the release key, or neither.',
    );
  }
  return { releases, publicKey };
}

module.exports = ({ config }) => {
  const appId = process.env.NOD_MOBILE_APP_ID;
  if (appId !== undefined && !appIdPattern.test(appId)) {
    throw new Error(
      'NOD_MOBILE_APP_ID must be a reverse-DNS name of lowercase letters and digits, such as org.example.nod',
    );
  }
  const source = updates();
  const build = buildNumber();
  return {
    ...config,
    version,
    ios: {
      ...config.ios,
      bundleIdentifier: appId ?? config.ios.bundleIdentifier,
      buildNumber: String(build),
    },
    android: {
      ...config.android,
      package: appId ?? config.android.package,
      versionCode: build,
      // Installing a downloaded update is the only reason to ask; a build
      // without an update source never does.
      permissions:
        source === null
          ? config.android.permissions
          : [
              ...config.android.permissions,
              'android.permission.REQUEST_INSTALL_PACKAGES',
            ],
    },
    plugins: [...config.plugins, './plugins/with-unsigned-release.js'],
    extra: { ...config.extra, updates: source },
  };
};
