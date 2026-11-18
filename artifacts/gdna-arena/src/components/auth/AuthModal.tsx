import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@workspace/gdna-ds/components/ui/dialog";
import { useLang } from "@/contexts/LangContext";
import { authCopy } from "@/i18n/auth-v2-copy";
import { AuthFlow, type AuthView } from "./AuthFlow";

interface Ctx { open: (view?: "login" | "signup") => void }
const AuthModalContext = createContext<Ctx>({ open: () => {} });
export const useAuthModal = () => useContext(AuthModalContext);

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const { lang } = useLang();
  const copy = authCopy(lang);
  const [state, setState] = useState<{ view: AuthView; n: number } | null>(null);
  const open = useCallback((v: "login" | "signup" = "login") =>
    setState(s => ({ view: v === "login" ? "login-choice" : "signup-choice", n: (s?.n ?? 0) + 1 })), []);
  return (
    <AuthModalContext.Provider value={{ open }}>
      {children}
      <Dialog open={!!state} onOpenChange={o => { if (!o) setState(null); }}>
        <DialogContent dir={lang === "ar" ? "rtl" : "ltr"} className="max-h-[92dvh] max-w-md overflow-y-auto" data-testid="auth-modal">
          <DialogTitle className="sr-only">{copy.login}</DialogTitle>
          <DialogDescription className="sr-only">{copy.loginTitle}</DialogDescription>
          {/* keyed by open count only, never by language: switching language keeps the form */}
          {state && <AuthFlow key={state.n} initial={state.view} onDone={() => setState(null)} />}
        </DialogContent>
      </Dialog>
    </AuthModalContext.Provider>
  );
}
