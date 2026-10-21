const { withAndroidManifest } = require('expo/config-plugins');

// Pairing asks the computer on the local network over plain HTTP; its answer
// is sealed with the code's secret. Android refuses cleartext by default and
// its network security config can't name private address ranges, so it is
// allowed app-wide. Relays stay https-only: @nod/core refuses any other.
module.exports = function withLocalPairing(config) {
  return withAndroidManifest(config, (next) => {
    const application = next.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:usesCleartextTraffic'] = 'true';
    }
    return next;
  });
};
