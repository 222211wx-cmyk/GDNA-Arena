// Initialize native gesture handling before any application/router module.
import 'react-native-gesture-handler';
// Background/headless handlers must exist before Expo Router loads any routes.
import './lib/call-service';
import 'expo-router/entry';