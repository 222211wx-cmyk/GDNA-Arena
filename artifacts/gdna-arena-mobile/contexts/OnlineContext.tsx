import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as Network from 'expo-network';
import { onlineManager } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { Typography } from '@workspace/gdna-ds/components/native/typography';
import { useColors } from '@workspace/gdna-ds/hooks/use-colors';

type OnlineContextValue = { isOnline: boolean };

const OnlineContext = createContext<OnlineContextValue | null>(null);
let networkOnline = true;

export class OfflineError extends Error {
  constructor() {
    super('You are offline. Reconnect to continue.');
    this.name = 'OfflineError';
  }
}

export function isNetworkOnline(): boolean {
  return networkOnline;
}

export function assertNetworkOnline(): void {
  if (!networkOnline) throw new OfflineError();
}

function updateOnline(next: boolean) {
  networkOnline = next;
  onlineManager.setOnline(next);
}

export function OnlineProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(networkOnline);

  useEffect(() => {
    const applyState = (connected: boolean | null | undefined) => {
      // Network APIs may initially report an unknown state. Do not incorrectly
      // block a usable connection until the native capability can determine it.
      const next = connected !== false;
      updateOnline(next);
      setIsOnline(next);
    };
    const subscription = Network.addNetworkStateListener(state => applyState(state.isConnected));
    void Network.getNetworkStateAsync().then(state => applyState(state.isConnected)).catch(() => {
      // A capability failure must not masquerade as an offline network.
      applyState(true);
    });
    return () => subscription.remove();
  }, []);

  const value = useMemo(() => ({ isOnline }), [isOnline]);
  return <OnlineContext.Provider value={value}>{children}</OnlineContext.Provider>;
}

export function useOnline() {
  const context = useContext(OnlineContext);
  if (!context) throw new Error('useOnline must be used within OnlineProvider');
  return context;
}

export function OfflineBanner() {
  const { isOnline } = useOnline();
  const colors = useColors();
  if (isOnline) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel="You are offline. Cached content remains available; actions are disabled."
      style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Typography variant="label" style={{ color: colors.foreground }}>You’re offline</Typography>
      <Typography variant="muted">Cached content remains available. Reconnect to take action.</Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderBottomWidth: 1, paddingHorizontal: 16, paddingVertical: 10, gap: 2 },
});