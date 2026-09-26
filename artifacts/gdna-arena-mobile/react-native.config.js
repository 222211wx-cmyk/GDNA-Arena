// Firebase transports Android calls only. iOS uses direct APNs PushKit;
// do not link or initialize Firebase pods without an iOS Firebase application.
module.exports = {
  dependencies: {
    '@react-native-firebase/app': { platforms: { ios: null } },
    '@react-native-firebase/messaging': { platforms: { ios: null } },
  },
};