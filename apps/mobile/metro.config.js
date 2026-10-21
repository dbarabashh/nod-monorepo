const { getDefaultConfig } = require('expo/metro-config');
const { withNativeAutomerge } = require('@nod/automerge-native/metro');

module.exports = withNativeAutomerge(getDefaultConfig(__dirname));
