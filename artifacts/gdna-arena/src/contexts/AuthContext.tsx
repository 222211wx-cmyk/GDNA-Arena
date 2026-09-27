import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { apiPath } from "@/lib/network";
import { trackEvent } from "@/lib/analytics";
import { PUSH_LOGOUT_EVENT } from "@/lib/call-firebase";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { useLang, type Lang } from "@/contexts/LangContext";

const sessionCopy: Record<Lang, { checking: string; unavailable: string; retry: string }> = {
  ar: { checking: "جارٍ التحقق من جلستك…", unavailable: "تعذّر التحقق من جلستك الآن. حاول مرة أخرى.", retry: "إعادة المحاولة" },
  en: { checking: "Checking your session…", unavailable: "Unable to verify your session right now. Please retry.", retry: "Retry" },
  fr: { checking: "Vérification de votre session…", unavailable: "Impossible de vérifier votre session actuellement. Réessayez.", retry: "Réessayer" },
  es: { checking: "Verificando tu sesión…", unavailable: "No se pudo verificar tu sesión. Inténtalo de nuevo.", retry: "Reintentar" },
  de: { checking: "Sitzung wird überprüft…", unavailable: "Deine Sitzung kann gerade nicht überprüft werden. Bitte versuche es erneut.", retry: "Erneut versuchen" },
};

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
  authError: string | null;
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>;
  register: (username: string, password: string, birthDate: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<string>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { lang } = useLang();
  const copy = sessionCopy[lang];
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authUnavailable, setAuthUnavailable] = useState(false);
  const [initialVerified, setInitialVerified] = useState(false);
  const authError = authUnavailable ? copy.unavailable : null;
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
        cache: "no-store",
        signal: controller.signal,
      });
      if (generation !== authGenerationRef.current) return;
      if (res.ok) {
        const data = await res.json();
        if (generation === authGenerationRef.current) {
          setUser(data);
          setAuthUnavailable(false);
          setInitialVerified(true);
        }
      } else if (res.status === 401) {
        setUser(null);
        setAuthUnavailable(false);
        setInitialVerified(true);
      } else {
        // A gateway error, rate limit, or outage is not a revoked cookie.
        setAuthUnavailable(true);
      }
    } catch (error) {
      if (generation === authGenerationRef.current && !controller.signal.aborted) {
        setAuthUnavailable(true);
      }
    } finally {
      if (generation === authGenerationRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void refreshUser();
    return () => authRequestRef.current?.abort();
  }, []);

  const login = async (username: string, password: string, rememberMe = true) => {
    const { controller, generation } = beginAuthRequest();
    const res = await fetch(apiPath("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username: username.trim(), password, rememberMe }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Login failed");
    if (generation === authGenerationRef.current) {
      trackEvent("auth_login_success", { method: "password" });
      setUser(data);
      setAuthUnavailable(false);
      setInitialVerified(true);
      setLoading(false);
    }
  };

  const register = async (username: string, password: string, birthDate: string) => {
    const { controller, generation } = beginAuthRequest();
    const res = await fetch(apiPath("/api/auth/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username: username.trim(), password, birthDate }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Registration failed");
    // Simple flow: registered = logged in immediately
    if (generation === authGenerationRef.current) {
      trackEvent("auth_register_success", { method: "password" });
      setUser(data);
      setAuthUnavailable(false);
      setInitialVerified(true);
      setLoading(false);
    }
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
    // Do not clear identity-bound surfaces until the server confirms logout;
    // callers must never report a successful logout while the session remains
    // alive.
    // Keep the user mounted until the server confirms the logout. This lets
    // the push hook revoke the active FCM installation only for a real logout,
    // rather than for an unmount caused by a failed request.
    const { controller, generation } = beginAuthRequest(false);
    const res = await fetch(apiPath("/api/auth/logout"), {
      method: "POST",
      credentials: "include",
      signal: controller.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Logout failed" }));
      throw new Error(data.error ?? "Logout failed");
    }
    if (generation !== authGenerationRef.current) return;
    window.dispatchEvent(new Event(PUSH_LOGOUT_EVENT));
    setUser(null);
    setAuthUnavailable(false);
  };

  // All sections wait for the authoritative cookie check. On a transient
  // failure with no verified identity, never render guest/login redirects.
  if (!initialVerified) {
    return (
      <AuthContext.Provider value={{ user, loading, authError, login, register, changePassword, logout, refreshUser }}>
        <div dir={lang === "ar" ? "rtl" : "ltr"} className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground" role="status">
          {loading ? (
            <p>{copy.checking}</p>
          ) : (
            <>
              <p role="alert">{authError}</p>
              <Button type="button" onClick={() => void refreshUser()}>{copy.retry}</Button>
            </>
          )}
        </div>
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={{ user, loading, authError, login, register, changePassword, logout, refreshUser }}>
      {authError && (
        <div dir={lang === "ar" ? "rtl" : "ltr"} role="alert" className="flex items-center justify-center gap-3 border-b border-destructive/30 bg-destructive/10 p-3 text-center text-sm text-foreground">
          <span>{authError}</span>
          <Button type="button" variant="outline" onClick={() => void refreshUser()}>{copy.retry}</Button>
        </div>
      )}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
