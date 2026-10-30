const { withAppBuildGradle } = require('expo/config-plugins');

const unsigned = `
// with-unsigned-release.js
android {
    buildTypes {
        release {
            signingConfig null
        }
    }
}
`;

// The template signs release builds with the debug key, which anyone has.
// A block at the end of the file overrides it, so a release APK leaves Gradle
// unsigned and is signed by the release workflow, in a job that installs
// nothing.
module.exports = function withUnsignedRelease(config) {
  return withAppBuildGradle(config, (gradle) => {
    if (!gradle.modResults.contents.includes(unsigned)) {
      gradle.modResults.contents += unsigned;
    }
    return gradle;
  });
};
