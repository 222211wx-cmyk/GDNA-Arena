import React, { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  apiPost,
  apiGet,
  ApiError,
  beginSessionTransition,
  clearCachedAuthUser,
  clearSessionCookie,
  getCachedAuthGeneration,
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
  accessWithPhone: (idToken: string) => Promise<'verified' | 'pending'>;
  retryPhoneAccess: () => Promise<'verified' | 'pending'>;
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
  const userRef = useRef<AuthUser | null>(null);
  const authTransitionRef = useRef(false);
  const phoneAccessRef = useRef<{ generation: number; cacheGeneration: number } | null>(null);
  const startupPendingRef = useRef(true);
  const refreshRef = useRef<{ generation: number; promise: Promise<void> } | null>(null);
  const commitUser = useCallback((next: AuthUser | null) => {
    userRef.current = next;
    setUser(next);
  }, []);

  const clearUnauthorizedSession = useCallback(async (generation: number) => {
    if (generation !== authGenerationRef.current) return;
    const previousUser = userRef.current;
    const clearedGeneration = ++authGenerationRef.current;
    commitUser(null);
    setIsLoading(false);
    setStartupError(null);
    startupPendingRef.current = false;
    // Clear locally before any network cleanup can yield. A stale /me response
    // must not revoke a newer login, nor can failed push cleanup keep identity.
    const storageCleanup = Promise.all([clearSessionCookie(), clearCachedAuthUser()]);
    const pushCleanup = previousUser
      ? forgetPushOnLogout(previousUser.id).catch(error => console.warn('Push cleanup after session revocation failed:', error))
      : Promise.resolve();
    await queryClient.cancelQueries();
    if (clearedGeneration === authGenerationRef.current) queryClient.clear();
    await Promise.all([storageCleanup, pushCleanup]);
  }, [commitUser, queryClient]);

  useEffect(() => {
    const generation = ++authGenerationRef.current;
    let cancelled = false;
    let sessionResolved = false;
    let timedOut = false;
    setIsLoading(true);
    startupPendingRef.current = true;
    setStartupError(null);
    const timer = setTimeout(() => {
      timedOut = true;
      if (cancelled || generation !== authGenerationRef.current) return;
      console.warn('Auth startup timed out while loading storage or verifying the session');
      if (!userRef.current && !sessionResolved) setStartupError('تعذّر الاتصال بالخادم أو قراءة الجلسة المحفوظة. تحقّق من اتصالك وحاول مجدداً.');
      startupPendingRef.current = false;
      setIsLoading(false);
    }, 12000);
    const bootstrap = async () => {
      try {
        const cacheGeneration = getCachedAuthGeneration();
        await Promise.all([loadSessionCookie(), loadCachedAuthUser()]);
        if (cancelled || timedOut || generation !== authGenerationRef.current) return;
        // Disk identity is not authentication. Only /me may establish the
        // initial owner; a previously verified in-memory owner survives outages.
        let fresh: AuthUser | null = null;
        let verifiedUnauthenticated = false;
        try {
          fresh = await apiGet<AuthUser>('/auth/me');
        } catch (error) {
          verifiedUnauthenticated = error instanceof ApiError && error.status === 401;
          if (!verifiedUnauthenticated) throw error;
        }
        if (cancelled || timedOut || generation !== authGenerationRef.current) return;
        if (fresh) {
          sessionResolved = true;
          commitUser(fresh);
          await saveCachedAuthUser(fresh, cacheGeneration);
        } else if (verifiedUnauthenticated) {
          sessionResolved = true;
          await clearUnauthorizedSession(generation);
        }
      } catch (error) {
        console.warn('Auth startup failed:', error);
        if (!cancelled && !timedOut && generation === authGenerationRef.current && !userRef.current && !sessionResolved) {
          setStartupError(error instanceof Error ? `تعذّر بدء التطبيق. حاول مجدداً. التفاصيل: ${error.message}` : 'تعذّر قراءة الجلسة المحفوظة. حاول مجدداً.');
        }
      } finally {
        if (!cancelled && !timedOut && generation === authGenerationRef.current) {
          clearTimeout(timer);
          startupPendingRef.current = false;
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
  }, [startupAttempt, commitUser, clearUnauthorizedSession]);

  const retryStartup = () => {
    if (!authTransitionRef.current) setStartupAttempt(attempt => attempt + 1);
  };

  const login = async (username: string, password: string) => {
    if (authTransitionRef.current) throw new Error('Authentication is already in progress.');
    phoneAccessRef.current = null;
    const previousUser = userRef.current;
    const generation = ++authGenerationRef.current;
    authTransitionRef.current = true;
    commitUser(null);
    setStartupError(null);
    // Keep the prior cookie for this request only. The server then rotates its
    // session, revokes old WebSockets, and returns the new account cookie.
    beginSessionTransition();
    const cacheCleanup = clearCachedAuthUser();
    const cacheGeneration = getCachedAuthGeneration();
    try {
      await cacheCleanup;
      if (previousUser) await forgetPushOnLogout(previousUser.id);
      if (generation !== authGenerationRef.current) return;
      await queryClient.cancelQueries();
      if (generation !== authGenerationRef.current) return;
      queryClient.clear();
      const data = await apiPost<AuthUser>('/auth/login', { username, password });
      if (generation !== authGenerationRef.current) return;
      await saveCachedAuthUser(data, cacheGeneration);
      if (generation === authGenerationRef.current) commitUser(data);
    } finally {
      if (generation === authGenerationRef.current) {
        authTransitionRef.current = false;
        startupPendingRef.current = false;
        setIsLoading(false);
      }
    }
  };

  const register = async (username: string, password: string, birthDate: string) => {
    if (authTransitionRef.current) throw new Error('Authentication is already in progress.');
    phoneAccessRef.current = null;
    const previousUser = userRef.current;
    const generation = ++authGenerationRef.current;
    authTransitionRef.current = true;
    commitUser(null);
    setStartupError(null);
    beginSessionTransition();
    const cacheCleanup = clearCachedAuthUser();
    const cacheGeneration = getCachedAuthGeneration();
    try {
      await cacheCleanup;
      if (previousUser) await forgetPushOnLogout(previousUser.id);
      if (generation !== authGenerationRef.current) return;
      await queryClient.cancelQueries();
      if (generation !== authGenerationRef.current) return;
      queryClient.clear();
      const data = await apiPost<AuthUser>('/auth/register', { username, password, birthDate });
      if (generation !== authGenerationRef.current) return;
      await saveCachedAuthUser(data, cacheGeneration);
      if (generation === authGenerationRef.current) commitUser(data);
    } finally {
      if (generation === authGenerationRef.current) {
        authTransitionRef.current = false;
        startupPendingRef.current = false;
        setIsLoading(false);
      }
    }
  };

  // A successful exchange carries only success, not identity. The native API
  // wrapper persists Set-Cookie before resolving; only /me may restore an owner.
  const verifyPhoneAccess = async (): Promise<'verified' | 'pending'> => {
    const pending = phoneAccessRef.current;
    if (!pending || pending.generation !== authGenerationRef.current) {
      throw new Error('Phone access is no longer pending. Request a fresh SMS verification.');
    }
    try {
      const fresh = await apiGet<AuthUser>('/auth/me');
      if (pending.generation !== authGenerationRef.current) throw new Error('Authentication changed.');
      await saveCachedAuthUser(fresh, pending.cacheGeneration);
      if (pending.generation !== authGenerationRef.current) throw new Error('Authentication changed.');
      phoneAccessRef.current = null;
      commitUser(fresh);
      return 'verified';
    } catch (error) {
      if (pending.generation !== authGenerationRef.current) throw error;
      if (error instanceof ApiError && error.status === 401) {
        phoneAccessRef.current = null;
        await clearUnauthorizedSession(pending.generation);
        throw error;
      }
      // Never replay the proof after a 200 exchange. Keep the new cookie and
      // retry its authoritative verification after network/server errors.
      return 'pending';
    }
  };

  const accessWithPhone = async (idToken: string): Promise<'verified' | 'pending'> => {
    if (authTransitionRef.current) throw new Error('Authentication is already in progress.');
    const previousUser = userRef.current;
    const generation = ++authGenerationRef.current;
    authTransitionRef.current = true;
    phoneAccessRef.current = null;
    commitUser(null);
    setStartupError(null);
    // Advance the native cookie epoch BEFORE starting the exchange, never
    // between its response and /me (that would discard the new Set-Cookie).
    beginSessionTransition();
    const cacheCleanup = clearCachedAuthUser();
    const cacheGeneration = getCachedAuthGeneration();
    try {
      await cacheCleanup;
      if (previousUser) await forgetPushOnLogout(previousUser.id);
      await queryClient.cancelQueries();
      if (generation !== authGenerationRef.current) throw new Error('Authentication changed.');
      queryClient.clear();
      const result = await apiPost<{ success: boolean }>('/auth/recovery/access', { idToken });
      if (generation !== authGenerationRef.current) throw new Error('Authentication changed.');
      if (result.success !== true) throw new Error('Phone access did not complete.');
      phoneAccessRef.current = { generation, cacheGeneration };
      return await verifyPhoneAccess();
    } finally {
      // A definitive /me 401 advances the auth generation during cleanup.
      // The serialized exchange still owns this lock and must release it.
      authTransitionRef.current = false;
      if (generation === authGenerationRef.current) {
        startupPendingRef.current = false;
        setIsLoading(false);
      }
    }
  };

  const retryPhoneAccess = async (): Promise<'verified' | 'pending'> => {
    if (authTransitionRef.current) throw new Error('Authentication is already in progress.');
    authTransitionRef.current = true;
    try { return await verifyPhoneAccess(); }
    finally { authTransitionRef.current = false; }
  };

  const submitBirthDate = async (birthDate: string) => {
    const generation = authGenerationRef.current;
    await apiPost('/auth/birth-date', { birthDate });
    if (generation === authGenerationRef.current) await refreshUser();
  };

  const logout = async () => {
    if (authTransitionRef.current) throw new Error('Authentication is already in progress.');
    phoneAccessRef.current = null;
    const previousUser = userRef.current;
    const generation = ++authGenerationRef.current;
    authTransitionRef.current = true;
    commitUser(null);
    setStartupError(null);
    beginSessionTransition();
    const cacheCleanup = clearCachedAuthUser();
    let pushCleanupError: unknown = null;
    try {
      const pushCleanup = previousUser
        ? forgetPushOnLogout(previousUser.id).catch(error => { pushCleanupError = error; })
        : Promise.resolve();
      await Promise.all([cacheCleanup, pushCleanup]);
      if (generation !== authGenerationRef.current) return;
      await queryClient.cancelQueries();
      if (generation !== authGenerationRef.current) return;
      queryClient.clear();
      // apiPost captures the current cookie synchronously before fetch yields.
      // Clear the local copy immediately after starting the server-side logout,
      // so this device cannot reuse it even if the network request fails.
      const serverLogout = apiPost('/auth/logout');
      await Promise.all([clearSessionCookie(), clearCachedAuthUser(), serverLogout]);
      if (pushCleanupError) throw pushCleanupError;
    } finally {
      if (generation === authGenerationRef.current) {
        authTransitionRef.current = false;
        startupPendingRef.current = false;
        setIsLoading(false);
      }
    }
  };

  const refreshUser = useCallback((): Promise<void> => {
    if (authTransitionRef.current || startupPendingRef.current) return Promise.resolve();
    const generation = authGenerationRef.current;
    if (refreshRef.current?.generation === generation) return refreshRef.current.promise;
    const cacheGeneration = getCachedAuthGeneration();
    const ownerId = userRef.current?.id;
    const promise = (async () => {
      try {
        const fresh = await apiGet<AuthUser>('/auth/me');
        if (generation !== authGenerationRef.current || ownerId !== userRef.current?.id) return;
        await saveCachedAuthUser(fresh, cacheGeneration);
        if (generation === authGenerationRef.current && ownerId === userRef.current?.id) {
          commitUser(fresh);
          setStartupError(null);
        }
      } catch (error) {
        if (generation !== authGenerationRef.current) return;
        if (error instanceof ApiError && error.status === 401) {
          await clearUnauthorizedSession(generation);
        } else {
          // Network, throttling, forbidden and server errors do not mean logout.
          console.warn('Session refresh failed; retaining verified identity:', error);
        }
      } finally {
        if (refreshRef.current?.generation === generation) refreshRef.current = null;
      }
    })();
    refreshRef.current = { generation, promise };
    return promise;
  }, [commitUser, clearUnauthorizedSession]);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', nextState => {
      const resumed = nextState === 'active' && previousState !== 'active';
      previousState = nextState;
      if (resumed) void refreshUser().catch(error => console.warn('Foreground session refresh failed:', error));
    });
    return () => subscription.remove();
  }, [refreshUser]);

  const renderedGeneration = authGenerationRef.current;
  const updateBalance = (newBalance: number) => {
    if (!user || renderedGeneration !== authGenerationRef.current || user.id !== userRef.current?.id) return;
    const updated = { ...userRef.current, balance: newBalance };
    commitUser(updated);
    void saveCachedAuthUser(updated, getCachedAuthGeneration())
      .catch(error => console.warn('Could not persist updated balance:', error));
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, startupError, retryStartup, login, register, accessWithPhone, retryPhoneAccess, submitBirthDate, logout, refreshUser, updateBalance }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
