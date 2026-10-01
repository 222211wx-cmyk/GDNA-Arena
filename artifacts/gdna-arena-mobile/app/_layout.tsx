import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useDesignSystemFonts } from '@workspace/gdna-ds/hooks/use-fonts';
import { useColors } from '@workspace/gdna-ds/hooks/use-colors';
import { nativeTheme } from '@workspace/gdna-ds/lib/native-theme';
import { Button } from '@workspace/gdna-ds/components/native/button';
import { Typography } from '@workspace/gdna-ds/components/native/typography';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { OfflineBanner, OnlineProvider } from '@/contexts/OnlineContext';
import { ClipPlaybackProvider } from '@/contexts/ClipPlaybackContext';
import { CallProvider } from '@/contexts/CallContext';
import { recordCallSetupError } from '@/lib/call-service';
import { listenForPushTaps, refreshPushIfAllowed } from '@/lib/native-push';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, networkMode: 'online' } },
});

function AuthGate() {
  const { user, isLoading, startupError } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading || startupError) return;
    const inAuth = segments[0] === '(auth)';
    const inPublicClip = ['clip', 'clips'].includes(segments[0] as string);
    if (!user && !inAuth && !inPublicClip) {
      router.replace('/(auth)/login');
    } else if (user && inAuth) {
      router.replace('/(tabs)');
    }
  }, [user, isLoading, startupError, segments]);

  useEffect(() => {
    if (!isLoading && user) void refreshPushIfAllowed(user.id).catch(recordCallSetupError);
  }, [isLoading, user?.id]);

  return null;
}

function RootLayoutNav() {
  const colors = useColors();
  const { startupError, retryStartup } = useAuth();
  const router = useRouter();
  useEffect(() => listenForPushTaps(path => router.push(path as never)), [router]);
  return (
    <>
      <AuthGate />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="chat" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="conversation/[roomId]" options={{ headerShown: false }} />
        <Stack.Screen name="finance" options={{ headerShown: false }} />
        <Stack.Screen name="recovery-phone" options={{ headerShown: false }} />
        <Stack.Screen name="clips" options={{ headerShown: false }} />
        <Stack.Screen name="clip/[code]" options={{ headerShown: false }} />
      </Stack>
      {startupError ? (
        <View style={[styles.startupFailure, { backgroundColor: colors.background }]}>
          <Typography variant="title">تعذّر تشغيل أرينا</Typography>
          <Typography accessibilityRole="alert">{startupError}</Typography>
          <Button onPress={retryStartup}>إعادة المحاولة</Button>
        </View>
      ) : null}
    </>
  );
}

export default function RootLayout() {
  const { fontsLoaded, fontError } = useDesignSystemFonts();
  const colors = useColors();
  const [fontWaitExpired, setFontWaitExpired] = useState(false);

  useEffect(() => {
    if (fontsLoaded || fontError) return;
    const timer = setTimeout(() => {
      console.warn('Font loading exceeded 8 seconds; continuing with system font fallback');
      setFontWaitExpired(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (fontsLoaded || fontError || fontWaitExpired) {
      if (fontError) console.warn('Font loading failed; using system font fallback', fontError);
      void SplashScreen.hideAsync().catch(error => console.warn('Could not hide splash screen', error));
    }
  }, [fontsLoaded, fontError, fontWaitExpired]);

  if (!fontsLoaded && !fontError && !fontWaitExpired) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <OnlineProvider>
            <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
              <OfflineBanner />
              <KeyboardProvider>
                <AuthProvider>
                  <ClipPlaybackProvider>
                    <CallProvider><RootLayoutNav /></CallProvider>
                  </ClipPlaybackProvider>
                </AuthProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </OnlineProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  startupFailure: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: nativeTheme.spacing * 4,
    padding: nativeTheme.spacing * 6,
  },
});
