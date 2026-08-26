import React, { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  apiPost,
  apiGet,
  ApiError,
  beginSessionTransition,
  clearCachedAuthUser,
  clearSessionCookie,
  loadCachedAuthUser,
  loadSessionCookie,
  saveCachedAuthUser,
  type AuthUser,
} from '@/lib/api';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, birthDate: string) => Promise<void>;
  submitBirthDate: (birthDate: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateBalance: (newBalance: number) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const authGenerationRef = useRef(0);

  useEffect(() => {
    const generation = ++authGenerationRef.current;
    let cancelled = false;
    (async () => {
      const [, cachedUser] = await Promise.all([
        loadSessionCookie(),
        loadCachedAuthUser(),
      ]);
      if (cancelled || generation !== authGenerationRef.current) return;
      // Native cached identity is encrypted and read-only while offline. It
      // keeps a valid citizen session usable during a cold airplane-mode launch.
      if (cachedUser) setUser(cachedUser);
      let fresh: AuthUser | null = null;
      let verifiedUnauthenticated = false;
      try {
        fresh = await apiGet<AuthUser>('/auth/me');
      } catch (error) {
        verifiedUnauthenticated = error instanceof ApiError && (error.status === 401 || error.status === 403);
      }
      if (cancelled || generation !== authGenerationRef.current) return;
      if (fresh) {
        setUser(fresh);
        await saveCachedAuthUser(fresh);
      } else if (verifiedUnauthenticated) {
        setUser(null);
        await Promise.all([clearSessionCookie(), clearCachedAuthUser()]);
      }
      if (!cancelled && generation === authGenerationRef.current) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
      authGenerationRef.current += 1;
    };
  }, []);

  const login = async (username: string, password: string) => {
    const generation = ++authGenerationRef.current;
    setUser(null);
    // Keep the prior cookie for this request only. The server then rotates its
    // session, revokes old WebSockets, and returns the new account cookie.
    beginSessionTransition();
    await queryClient.cancelQueries();
    queryClient.clear();
    const data = await apiPost<AuthUser>('/auth/login', { username, password });
    if (generation !== authGenerationRef.current) return;
    await saveCachedAuthUser(data);
    if (generation === authGenerationRef.current) setUser(data);
  };

  const register = async (username: string, password: string, birthDate: string) => {
    const generation = ++authGenerationRef.current;
    setUser(null);
    beginSessionTransition();
    await queryClient.cancelQueries();
    queryClient.clear();
    const data = await apiPost<AuthUser>('/auth/register', { username, password, birthDate });
    if (generation !== authGenerationRef.current) return;
    await saveCachedAuthUser(data);
    if (generation === authGenerationRef.current) setUser(data);
  };

  const submitBirthDate = async (birthDate: string) => {
    await apiPost('/auth/birth-date', { birthDate });
    await refreshUser();
  };

  const logout = async () => {
    ++authGenerationRef.current;
    setUser(null);
    beginSessionTransition();
    await queryClient.cancelQueries();
    queryClient.clear();
    // apiPost captures the current cookie synchronously before fetch yields.
    // Clear the local copy immediately after starting the server-side logout,
    // so this device cannot reuse it even if the network request fails.
    const serverLogout = apiPost('/auth/logout');
    await Promise.all([clearSessionCookie(), clearCachedAuthUser()]);
    await serverLogout;
  };

  const refreshUser = async () => {
    const generation = authGenerationRef.current;
    const fresh = await apiGet<AuthUser>('/auth/me').catch(() => null);
    if (fresh && generation === authGenerationRef.current) {
      await saveCachedAuthUser(fresh);
      if (generation === authGenerationRef.current) setUser(fresh);
    }
  };

  const updateBalance = (newBalance: number) => {
    if (!user) return;
    const updated = { ...user, balance: newBalance };
    setUser(updated);
    void saveCachedAuthUser(updated);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, submitBirthDate, logout, refreshUser, updateBalance }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
