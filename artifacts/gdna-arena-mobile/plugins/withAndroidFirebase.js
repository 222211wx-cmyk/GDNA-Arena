const path = require('node:path');
const { createRunOncePlugin, withPlugins } = require('expo/config-plugins');

// RNFirebase's stock app plugin unconditionally configures FirebaseApp on iOS
// and requires GoogleService-Info.plist. This app uses Firebase only on Android.
// Resolve from package.json because RNFirebase's exports map does not expose
// plugin/build/android as a package subpath.
const appRoot = path.dirname(require.resolve('@react-native-firebase/app/package.json'));
const {
  withBuildscriptDependency,
  withApplyGoogleServicesPlugin,
  withCopyAndroidGoogleServices,
} = require(path.join(appRoot, 'plugin/build/android'));
const messaging = require('@react-native-firebase/messaging/app.plugin.js').default;

function withAndroidFirebase(config) {
  return withPlugins(config, [
    withBuildscriptDependency,
    withApplyGoogleServicesPlugin,
    withCopyAndroidGoogleServices,
    // In installed 23.8.6 this official plugin registers Android manifest mods only.
    messaging,
  ]);
}

module.exports = createRunOncePlugin(withAndroidFirebase, 'gdna-android-firebase', '1.0.0');