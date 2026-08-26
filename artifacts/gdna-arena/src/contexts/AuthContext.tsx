import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { apiPath } from "@/lib/network";

export interface AuthUser {
  id: number;
  username: string;
  balance: number;
  xp: number;
  gamesPlayed: number;
  wins: number;
  canClaimDaily: boolean;
  isAdmin?: boolean;
  isAdult: boolean | null;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>;
  register: (username: string, password: string, birthDate: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<string>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const authGenerationRef = useRef(0);
  const authRequestRef = useRef<AbortController | null>(null);

  const beginAuthRequest = (clearCurrentUser = false) => {
    authRequestRef.current?.abort();
    const controller = new AbortController();
    authRequestRef.current = controller;
    const generation = ++authGenerationRef.current;
    if (clearCurrentUser) setUser(null);
    return { controller, generation };
  };

  const refreshUser = async () => {
    const { controller, generation } = beginAuthRequest();
    try {
      const res = await fetch(apiPath("/api/auth/me"), {
        credentials: "include",
        signal: controller.signal,
      });
      if (generation !== authGenerationRef.current) return;
      if (res.ok) {
        const data = await res.json();
        if (generation === authGenerationRef.current) setUser(data);
      } else {
        setUser(null);
      }
    } catch (error) {
      if (generation === authGenerationRef.current && !controller.signal.aborted) {
        setUser(null);
      }
    }
  };

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
    return () => authRequestRef.current?.abort();
  }, []);

  const login = async (username: string, password: string, rememberMe = true) => {
    const { controller, generation } = beginAuthRequest(true);
    const res = await fetch(apiPath("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password, rememberMe }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Login failed");
    if (generation === authGenerationRef.current) setUser(data);
  };

  const register = async (username: string, password: string, birthDate: string) => {
    const { controller, generation } = beginAuthRequest(true);
    const res = await fetch(apiPath("/api/auth/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password, birthDate }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Registration failed");
    // Simple flow: registered = logged in immediately
    if (generation === authGenerationRef.current) setUser(data);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    const res = await fetch(apiPath("/api/auth/change-password"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Change password failed");
    return data.message as string;
  };

  const logout = async () => {
    // Hide every identity-bound surface immediately. The server response is
    // still checked so callers never report a successful logout while the
    // authenticated session remains alive.
    const { controller } = beginAuthRequest(true);
    const res = await fetch(apiPath("/api/auth/logout"), {
      method: "POST",
      credentials: "include",
      signal: controller.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Logout failed" }));
      throw new Error(data.error ?? "Logout failed");
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, changePassword, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
