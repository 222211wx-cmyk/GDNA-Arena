import React, { createContext, useContext, type ReactNode } from 'react';
import { useAgoraCalls } from '@/lib/agora-calls';
import { useAuth } from './AuthContext';
const Context = createContext<ReturnType<typeof useAgoraCalls> | null>(null);
export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const calls = useAgoraCalls(user, () => {});
  return <Context.Provider value={calls}>{children}</Context.Provider>;
}
export function useCalls() {
  const calls = useContext(Context);
  if (!calls) throw new Error('CallProvider is missing.');
  return calls;
}