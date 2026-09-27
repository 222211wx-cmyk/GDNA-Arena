import React, { createContext, useContext, useEffect, useCallback, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { useAuth } from './AuthContext';
import { useAgoraCalls as useUnavailableCalls } from '@/lib/agora-calls.web';
import type { useAgoraCalls } from '@/lib/agora-calls';
import { bindCallController } from '@/lib/call-service';

type Calls = ReturnType<typeof useAgoraCalls>;
const CallContext = createContext<Calls | null>(null);
// Do not load native Agora / crypto modules in Expo Go or a browser.
let nativeHook: typeof useAgoraCalls | null = null;
let initializationError: string | undefined;
if (Platform.OS !== 'web' && Constants.executionEnvironment !== 'storeClient') {
  try {
    require('react-native-agora');
    nativeHook = require('@/lib/agora-calls').useAgoraCalls;
  }
  catch {
    nativeHook = null;
    initializationError = 'The native call engine could not load in this installed build. An updated APK is required; this is not an internet or account error.';
  }
}
function NativeOwner({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();
  const navigate = useCallback(() => { router.push('/(tabs)/amis'); }, [router]);
  const calls = nativeHook!(user, navigate);
  useEffect(() => user ? bindCallController(user.id, calls, navigate) : undefined, [user?.id, calls.call, calls.answer, calls.reject, calls.end, navigate]);
  return <CallContext.Provider value={calls}>{children}</CallContext.Provider>;
}
function UnavailableOwner({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const calls = useUnavailableCalls(user, () => {}, initializationError);
  return <CallContext.Provider value={calls as Calls}>{children}</CallContext.Provider>;
}
export function CallProvider({ children }: { children: ReactNode }) {
  return nativeHook ? <NativeOwner>{children}</NativeOwner> : <UnavailableOwner>{children}</UnavailableOwner>;
}
export function useCalls() {
  const calls = useContext(CallContext);
  if (!calls) throw new Error('CallProvider is missing.');
  return calls;
}