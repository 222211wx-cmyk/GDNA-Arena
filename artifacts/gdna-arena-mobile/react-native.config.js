// Firebase transports Android calls and SMS recovery only. iOS uses direct APNs PushKit;
// do not link or initialize Firebase pods without an iOS Firebase application.
module.exports = {
  dependencies: {
    '@react-native-firebase/app': { platforms: { ios: null } },
    '@react-native-firebase/auth': { platforms: { ios: null } },
    '@react-native-firebase/messaging': { platforms: { ios: null } },
  },
};