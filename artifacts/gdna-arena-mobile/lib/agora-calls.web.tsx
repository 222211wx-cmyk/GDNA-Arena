import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import type { AuthUser } from './api';

export type ActiveCall = {
  callId: string;
  peer: string;
  video: boolean;
  incoming: boolean;
  phase: 'idle' | 'incoming' | 'ringing' | 'connecting' | 'active' | 'reconnecting';
  remoteUid?: number;
  startedAt?: number;
};

export function AgoraSurface({ style }: { uid: number; local?: boolean; style?: object }) {
  return <View style={style} />;
}

export function useAgoraCalls(_user: AuthUser | null, _onIncoming: () => void) {
  const [error, setError] = useState<string | null>(null);
  const unavailable = useCallback(async () => {
    const message = 'Agora calls are available in the native iOS and Android app.';
    setError(message);
    throw new Error(message);
  }, []);
  const testConnection = useCallback(async () => {
    setError('Agora connection testing is available in the native iOS and Android app.');
  }, []);
  return {
    call: null as ActiveCall | null,
    error,
    preflight: null as string | null,
    start: unavailable,
    answer: unavailable,
    reject: () => undefined,
    end: () => undefined,
    testConnection,
  };
}