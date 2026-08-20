import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiPost, apiGet, clearSessionCookie, loadSessionCookie, type AuthUser } from '@/lib/api';

const USER_KEY = '@gdna_user';

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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      await loadSessionCookie();
      const stored = await AsyncStorage.getItem(USER_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as AuthUser;
          setUser(parsed);
          // Re-verify with server
          const fresh = await apiGet<AuthUser>('/auth/me').catch(() => null);
          if (fresh) {
            setUser(fresh);
            await AsyncStorage.setItem(USER_KEY, JSON.stringify(fresh));
          } else {
            setUser(null);
            await AsyncStorage.removeItem(USER_KEY);
          }
        } catch {
          setUser(null);
        }
      }
      setIsLoading(false);
    })();
  }, []);

  const login = async (username: string, password: string) => {
    const data = await apiPost<AuthUser>('/auth/login', { username, password });
    setUser(data);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(data));
  };

  const register = async (username: string, password: string, birthDate: string) => {
    const data = await apiPost<AuthUser>('/auth/register', { username, password, birthDate });
    setUser(data);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(data));
  };

  const submitBirthDate = async (birthDate: string) => {
    await apiPost('/auth/birth-date', { birthDate });
    await refreshUser();
  };

  const logout = async () => {
    await apiPost('/auth/logout').catch(() => {});
    await clearSessionCookie();
    await AsyncStorage.removeItem(USER_KEY);
    setUser(null);
  };

  const refreshUser = async () => {
    const fresh = await apiGet<AuthUser>('/auth/me').catch(() => null);
    if (fresh) {
      setUser(fresh);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(fresh));
    }
  };

  const updateBalance = (newBalance: number) => {
    if (!user) return;
    const updated = { ...user, balance: newBalance };
    setUser(updated);
    AsyncStorage.setItem(USER_KEY, JSON.stringify(updated));
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
