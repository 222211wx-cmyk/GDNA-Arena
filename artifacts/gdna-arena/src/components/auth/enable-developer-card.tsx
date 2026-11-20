import { useState, type FormEvent } from "react";
import { Code2, Loader2, Check } from "lucide-react";
import { Card, CardContent } from "@workspace/gdna-ds/components/ui/card";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { apiPath } from "@/lib/network";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { PasswordField } from "./fields";

const COPY = {
  en: {
    title: "Enable Developer",
    body: "Turn on developer access for this same account. Enter your current password. No new account is created and your sign-in stays the same.",
    password: "Current password",
    show: "Show password",
    hide: "Hide password",
    submit: "Enable Developer",
    working: "Enabling…",
    enabled: "Developer access is on for this account.",
    invalid: "The password is wrong. Try again.",
    unauth: "Sign in first, then enable developer access.",
    server: "Something went wrong. Try again in a moment.",
  },
  fr: {
    title: "Activer le mode développeur",
    body: "Activez l'accès développeur pour ce même compte. Saisissez votre mot de passe actuel. Aucun nouveau compte n'est créé et votre connexion reste la même.",
    password: "Mot de passe actuel",
    show: "Afficher le mot de passe",
    hide: "Masquer le mot de passe",
    submit: "Activer le mode développeur",
    working: "Activation…",
    enabled: "L'accès développeur est activé pour ce compte.",
    invalid: "Le mot de passe est incorrect. Réessayez.",
    unauth: "Connectez-vous d'abord, puis activez l'accès développeur.",
    server: "Une erreur est survenue. Réessayez dans un instant.",
  },
  ar: {
    title: "تفعيل وضع المطوّر",
    body: "فعّل صلاحيات المطوّر لهذا الحساب نفسه. أدخل كلمة المرور الحالية. لن يُنشأ حساب جديد، وتبقى طريقة تسجيل دخولك كما هي.",
    password: "كلمة المرور الحالية",
    show: "إظهار كلمة المرور",
    hide: "إخفاء كلمة المرور",
    submit: "تفعيل وضع المطوّر",
    working: "جارٍ التفعيل…",
    enabled: "تم تفعيل صلاحيات المطوّر لهذا الحساب.",
    invalid: "كلمة المرور غير صحيحة. حاول مرة أخرى.",
    unauth: "سجّل الدخول أولاً، ثم فعّل صلاحيات المطوّر.",
    server: "حدث خطأ. حاول مرة أخرى بعد لحظات.",
  },
} as const;

/** Grants developer access to the signed-in account after the password is checked. Shown only when not yet granted. */
export function EnableDeveloperCard() {
  const { lang } = useLang();
  const t = COPY[lang === "fr" || lang === "ar" ? lang : "en"];
  const { user, refreshUser } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!user) return null;
  if (user.developerParticle && !done) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch(apiPath("/api/auth/v2/developer/enable"), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && data.code === "UNAUTHENTICATED") setError(t.unauth);
      else if (res.status === 401 || data.code === "INVALID_CREDENTIALS") setError(t.invalid);
      else if (!res.ok) setError(t.server);
      else { setDone(true); setPassword(""); await refreshUser(); }
    } catch {
      setError(t.server);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border bg-card" data-testid="enable-developer-card">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Code2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">{t.title}</h3>
            <p className="text-xs text-muted-foreground">{t.body}</p>
          </div>
        </div>
        {done ? (
          <p role="status" className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300" data-testid="developer-enabled">
            <Check className="h-4 w-4" aria-hidden="true" />{t.enabled}
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <PasswordField id="developer-password" label={t.password} value={password} onChange={setPassword} autoComplete="current-password" required showLabel={t.show} hideLabel={t.hide} />
            {error && <p role="alert" className="rounded-xl bg-destructive/10 p-2 text-sm text-destructive" data-testid="developer-error">{error}</p>}
            <Button type="submit" disabled={busy || !password} className="h-11 w-full gap-2 rounded-2xl" data-testid="button-enable-developer">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Code2 className="h-4 w-4" aria-hidden="true" />}
              {busy ? t.working : t.submit}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
