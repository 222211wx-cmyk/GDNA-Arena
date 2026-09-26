import Constants from 'expo-constants';
// Route discovery must not initialize Nitro modules in Expo Go. Only secure
// feature use loads the native implementation and reports its availability.
export const nativeSubtle = new Proxy({} as typeof import('react-native-quick-crypto').subtle, {
  get(_target, key) {
    if (Constants.executionEnvironment === 'storeClient') {
      throw new Error('Secure calls and device keys require an installed native build, not Expo Go.');
    }
    const subtle = require('react-native-quick-crypto').subtle;
    const value = subtle[key];
    return typeof value === 'function' ? value.bind(subtle) : value;
  },
});