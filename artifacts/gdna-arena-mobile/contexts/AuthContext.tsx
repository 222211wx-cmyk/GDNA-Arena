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
import { forgetPushOnLogout } from '@/lib/native-push';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  startupError: string | null;
  retryStartup: () => void;
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
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupAttempt, setStartupAttempt] = useState(0);
  const authGenerationRef = useRef(0);

  useEffect(() => {
    const generation = ++authGenerationRef.current;
    let cancelled = false;
    let cachedUser: AuthUser | null = null;
    let sessionResolved = false;
    let timedOut = false;
    setIsLoading(true);
    setStartupError(null);
    const timer = setTimeout(() => {
      timedOut = true;
      if (cancelled || generation !== authGenerationRef.current) return;
      console.warn('Auth startup timed out while loading storage or verifying the session');
      if (!cachedUser && !sessionResolved) setStartupError('تعذّر الاتصال بالخادم أو قراءة الجلسة المحفوظة. تحقّق من اتصالك وحاول مجدداً.');
      setIsLoading(false);
    }, 12000);
    const bootstrap = async () => {
      try {
        const [, restoredUser] = await Promise.all([loadSessionCookie(), loadCachedAuthUser()]);
        if (cancelled || timedOut || generation !== authGenerationRef.current) return;
        cachedUser = restoredUser;
        // Cached identity remains usable offline; never erase it on a network failure.
        if (cachedUser) setUser(cachedUser);
        let fresh: AuthUser | null = null;
        let verifiedUnauthenticated = false;
        try {
          fresh = await apiGet<AuthUser>('/auth/me');
        } catch (error) {
          verifiedUnauthenticated = error instanceof ApiError && (error.status === 401 || error.status === 403);
          if (!verifiedUnauthenticated) throw error;
        }
        if (cancelled || timedOut || generation !== authGenerationRef.current) return;
        if (fresh) {
          sessionResolved = true;
          setUser(fresh);
          await saveCachedAuthUser(fresh);
        } else if (verifiedUnauthenticated) {
          sessionResolved = true;
          setUser(null);
          await Promise.all([clearSessionCookie(), clearCachedAuthUser()]);
        }
      } catch (error) {
        console.warn('Auth startup failed:', error);
        if (!cancelled && !timedOut && generation === authGenerationRef.current && !cachedUser && !sessionResolved) {
          setStartupError(error instanceof Error ? `تعذّر بدء التطبيق. حاول مجدداً. التفاصيل: ${error.message}` : 'تعذّر قراءة الجلسة المحفوظة. حاول مجدداً.');
        }
      } finally {
        if (!cancelled && !timedOut && generation === authGenerationRef.current) {
          clearTimeout(timer);
          setIsLoading(false);
        }
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      authGenerationRef.current += 1;
    };
  }, [startupAttempt]);

  const retryStartup = () => setStartupAttempt(attempt => attempt + 1);

  const login = async (username: string, password: string) => {
    if (user) await forgetPushOnLogout(user.id);
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
    if (user) await forgetPushOnLogout(user.id);
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
    let pushCleanupError: unknown = null;
    try { if (user) await forgetPushOnLogout(user.id); }
    catch (error) { pushCleanupError = error; }
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
    if (pushCleanupError) throw pushCleanupError;
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
    <AuthContext.Provider value={{ user, isLoading, startupError, retryStartup, login, register, submitBirthDate, logout, refreshUser, updateBalance }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
