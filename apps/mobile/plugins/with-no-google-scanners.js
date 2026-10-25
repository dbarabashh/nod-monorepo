const fs = require('node:fs');
const path = require('node:path');
const {
  AndroidConfig,
  withDangerousMod,
  withGradleProperties,
} = require('expo/config-plugins');

const keepRulesMarker = '# nod: Google scanners left out of the build';

// R8 still sees expo-camera's barcode and document scanner code, which
// names ML Kit and Play services classes that are no longer in the build.
// Nothing calls that code on Android, so the missing classes are expected.
const keepRules = `
${keepRulesMarker}
-dontwarn com.google.mlkit.**
-dontwarn com.google.android.gms.tasks.**
`;

// expo-camera links Google's ML Kit document scanner on Android unless this
// property is false, and expo-camera's own plugin has no option for it. That
// scanner comes with Google Play services and a transport that sends usage
// metrics to Google; Nod scans nothing but the pairing QR code, read with
// ZXing in modules/qr-scanner. The barcode scanner is turned off through
// expo-camera's own barcodeScannerEnabled option in app.json.
module.exports = function withNoGoogleScanners(config) {
  config = withGradleProperties(config, (gradle) => {
    gradle.modResults =
      AndroidConfig.BuildProperties.updateAndroidBuildProperty(
        gradle.modResults,
        'expo.camera.document-scanner-enabled',
        'false',
      );
    return gradle;
  });
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const rules = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro',
      );
      const current = fs.existsSync(rules)
        ? fs.readFileSync(rules, 'utf8')
        : '';
      if (!current.includes(keepRulesMarker)) {
        fs.writeFileSync(rules, `${current.trimEnd()}\n${keepRules}`);
      }
      return mod;
    },
  ]);
};
