import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Input } from "@workspace/gdna-ds/components/ui/input";
import { Label } from "@workspace/gdna-ds/components/ui/label";
import { apiPath } from "@/lib/network";
import { useLang } from "@/contexts/LangContext";
import { AuthApiError, useAuth } from "@/contexts/AuthContext";
import { authCopy, authErrorText } from "@/i18n/auth-v2-copy";
import { developerCopy } from "@/i18n/developer-copy";
import { DobSelect, OtpInput, PhoneField, dobToIso, toE164, useCountdown } from "./fields";

export type AuthView =
  | "login-choice" | "login-email" | "signup-choice" | "signup-email"
  | "device" | "forgot-phone" | "forgot-code" | "forgot-new" | "phone-verify"
  | "dev-signup" | "dev-code";

interface AuthConfig { googleClientId: string | null; googleMock: boolean; sms: boolean; smsReal: boolean }

async function v2(path: string, body?: unknown) {
  let res: Response;
  try {
    res = await fetch(apiPath(`/api/auth/v2/${path}`), {
      method: body === undefined ? "GET" : "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new AuthApiError("NETWORK"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthApiError(data.code ?? "SERVER_ERROR");
  return data;
}

declare global {
  interface Window { google?: { accounts: { id: {
    initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }) => void;
    renderButton: (el: HTMLElement, o: Record<string, unknown>) => void } } } }
}

function loadGoogle(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => resolve(); s.onerror = () => reject(new Error("gsi"));
    document.head.appendChild(s);
  });
}

function GoogleButton({ label, config, onCredential, onUnavailable }: {
  label: string; config: AuthConfig | null; onCredential: (c: string) => void; onUnavailable: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const clientId = config?.googleClientId;
  const lastCb = useRef(onCredential);
  lastCb.current = onCredential;
  useEffect(() => {
    if (!clientId || !host.current) return;
    let cancelled = false;
    loadGoogle().then(() => {
      if (cancelled || !host.current) return;
      window.google!.accounts.id.initialize({ client_id: clientId, callback: r => lastCb.current(r.credential) });
      window.google!.accounts.id.renderButton(host.current, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width: Math.min(host.current.clientWidth || 320, 400) });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [clientId]);
  if (clientId) return <div ref={host} dir="ltr" className="flex min-h-11 w-full justify-center" data-testid="google-button" />;
  const mock = config?.googleMock;
  return (
    <Button type="button" variant="outline" className="h-11 w-full gap-2 bg-white text-black hover:bg-white/90" data-testid="google-button"
      onClick={() => {
        if (!mock) { onUnavailable(); return; }
        const email = window.prompt("Mock Google email", "demo@example.com");
        if (email) onCredential(`mock:${email}:${email}:${email.split("@")[0]}`);
      }}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
      {label}
    </Button>
  );
}

/** The whole sign-in / sign-up / recovery experience. Used by the header modal and by /login, /register. */
export function AuthFlow({ initial = "login-choice", onDone, onClose }: { initial?: AuthView; onDone: () => void; onClose?: () => void }) {
  const { lang } = useLang();
  const copy = authCopy(lang);
  const dev = developerCopy(lang);
  const { authV2, refreshUser } = useAuth();
  const [view, setView] = useState<AuthView>(initial);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form values live here, above the views and outside any key tied to the language,
  // so switching language keeps everything the citizen already typed.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [dial, setDial] = useState("+212");
  const [local, setLocal] = useState("");
  const [dob, setDob] = useState({ d: "", m: "", y: "" });
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<{ id: string; masked: string } | null>(null);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [left, restart] = useCountdown(0);

  useEffect(() => { v2("config").then(setConfig).catch(() => {}); }, []);

  const go = (v: AuthView) => { setView(v); setErrorCode(null); setNotice(null); setCode(""); };
  const phone = toE164(dial, local);
  const error = errorCode ? (dev.errors[errorCode] ?? authErrorText(copy, errorCode)) : null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErrorCode(null);
    try { await fn(); }
    catch (e) { setErrorCode(e instanceof AuthApiError ? e.code : "SERVER_ERROR"); }
    finally { setBusy(false); }
  };

  const showDevCode = async (forPhone: string) => {
    setDevCode(null);
    if (config?.smsReal !== false || !import.meta.env.DEV) return;
    const r = await v2(`dev/last-sms?phone=${encodeURIComponent(forPhone)}`).catch(() => null);
    if (r?.code) setDevCode(r.code);
  };

  const finish = (r: Awaited<ReturnType<typeof authV2>>, signup = false) => {
    if (r.status === "device_verification") {
      setChallenge({ id: r.challengeId, masked: r.maskedPhone });
      restart(r.resendIn);
      go("device");
      void showDevCode(r.maskedPhone);
      return;
    }
    if (signup && r.phoneChallengeId) {
      setChallenge({ id: r.phoneChallengeId, masked: phone });
      restart(60);
      go("phone-verify");
      void showDevCode(phone);
      return;
    }
    onDone();
  };

  const submitLogin = (e: FormEvent) => { e.preventDefault(); void run(async () => finish(await authV2("login", { identifier, password, rememberMe: remember }))); };
  const submitSignup = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => finish(await authV2("signup", {
      name, email, password, phone: phone || undefined, birthDate: dobToIso(dob), rememberMe: remember,
    }), true));
  };
  const google = (credential: string) => void run(async () => finish(await authV2("google", { credential, rememberMe: true })));

  const sendForgot = () => run(async () => {
    const r = await v2("forgot/send", { phone });
    setChallenge({ id: r.challengeId, masked: phone }); restart(r.resendIn); go("forgot-code"); void showDevCode(phone);
  });
  const resend = () => run(async () => {
    if (view === "forgot-code") await sendForgot();
    else if (view === "device" && challenge) {
      const r = await v2("device/resend", { challengeId: challenge.id });
      setChallenge({ ...challenge, id: r.challengeId }); restart(r.resendIn); setCode(""); void showDevCode(challenge.masked);
    } else if (view === "dev-code" && challenge) {
      const r = await v2("developer/resend", { challengeId: challenge.id });
      setChallenge({ ...challenge, id: r.challengeId }); restart(r.resendIn); setCode(""); void showDevCode(phone);
    } else if (view === "phone-verify") {
      const r = await v2("phone/send", { phone }); setChallenge({ id: r.challengeId, masked: phone }); restart(r.resendIn); setCode(""); void showDevCode(phone);
    }
  });
  const verifyCode = (value = code) => run(async () => {
    if (!challenge || value.length !== 6) return;
    if (view === "forgot-code") {
      const r = await v2("forgot/verify", { challengeId: challenge.id, code: value });
      setResetToken(r.resetToken); go("forgot-new");
    } else if (view === "device") {
      finish(await authV2("device/verify", { challengeId: challenge.id, code: value, rememberMe: remember }));
    } else if (view === "dev-code") {
      // Creates the account (Postgres) and signs in; the user then lands in the real app.
      await authV2("developer/verify", { challengeId: challenge.id, code: value, rememberMe: true });
      onDone();
    } else if (view === "phone-verify") {
      await v2("phone/verify", { challengeId: challenge.id, code: value });
      setNotice(copy.phoneVerified); await refreshUser(); onDone();
    }
  });
  const submitDeveloper = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await v2("developer/start", { email, username, password, phone });
      setChallenge({ id: r.challengeId, masked: r.maskedPhone }); restart(r.resendIn); go("dev-code"); void showDevCode(phone);
    });
  };
  const saveNewPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await v2("forgot/reset", { resetToken, newPassword });
      setPassword(""); setNewPassword(""); go("login-email"); setNotice(copy.passwordChanged);
    });
  };

  const google_ = <GoogleButton label={copy.continueGoogle} config={config} onCredential={google} onUnavailable={() => setErrorCode("GOOGLE_UNAVAILABLE")} />;
  const row = (children: ReactNode) => <div className="space-y-1">{children}</div>;
  const title = ({
    "login-choice": copy.loginTitle, "login-email": copy.loginTitle, "signup-choice": copy.signupTitle, "signup-email": copy.signupTitle,
    device: copy.deviceTitle, "dev-signup": dev.title, "dev-code": copy.codeTitle, "forgot-phone": copy.forgotTitle, "forgot-code": copy.codeTitle, "forgot-new": copy.newPasswordTitle, "phone-verify": copy.phoneStepTitle,
  })[view];
  const showBack = view !== initial && view !== "login-choice" && view !== "signup-choice";
  const backTo: AuthView = view === "signup-email" || view === "dev-signup" ? "signup-choice" : view === "dev-code" ? "dev-signup" : view === "forgot-code" || view === "forgot-new" ? "forgot-phone" : "login-choice";

  const codeBlock = (intro: string) => (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{intro}</p>
      <OtpInput value={code} onChange={setCode} onComplete={v => void verifyCode(v)} />
      {devCode && <p className="rounded-md bg-muted p-2 text-center text-sm" data-testid="dev-code"><span>{copy.devCode}: </span><b dir="ltr" className="tracking-widest">{devCode}</b></p>}
      <Button type="button" className="h-11 w-full" disabled={busy || code.length !== 6} onClick={() => void verifyCode()}>{busy ? copy.working : copy.verify}</Button>
      <Button type="button" variant="ghost" className="w-full" disabled={left > 0 || busy} onClick={() => void resend()} data-testid="resend">
        {left > 0 ? copy.resendIn(left) : copy.resend}
      </Button>
      {view === "phone-verify" && <Button type="button" variant="ghost" className="w-full" data-testid="skip-phone" onClick={() => void refreshUser().then(onDone)}>{copy.skip}</Button>}
    </div>
  );

  return (
    <div className="space-y-4" data-testid={`auth-${view}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold">{title}</h2>
        {showBack && <Button type="button" variant="ghost" size="sm" onClick={() => go(backTo)}>{copy.back}</Button>}
      </div>
      {notice && <p role="status" className="rounded-md bg-primary/10 p-2 text-sm">{notice}</p>}
      {error && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive" data-testid="auth-error" data-code={errorCode}>{error}</p>}

      {(view === "login-choice" || view === "signup-choice") && (
        <div className="space-y-3">
          {google_}
          <Button type="button" variant="outline" className="h-11 w-full" data-testid="continue-email" onClick={() => go(view === "login-choice" ? "login-email" : "signup-email")}>{copy.continueEmail}</Button>
          {view === "login-choice" ? (
            <>
              <Button type="button" variant="link" className="w-full" data-testid="forgot-link" onClick={() => go("forgot-phone")}>{copy.forgot}</Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => go("signup-choice")}>{copy.noAccount}</Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" className="h-11 w-full" data-testid="developer-signup" onClick={() => go("dev-signup")}>{dev.cta}</Button>
              <p className="text-center text-xs text-muted-foreground">{copy.phoneOptionalHint}</p>
              <Button type="button" variant="ghost" className="w-full" onClick={() => go("login-choice")}>{copy.haveAccount}</Button>
            </>
          )}
        </div>
      )}

      {view === "login-email" && (
        <form onSubmit={submitLogin} className="space-y-3">
          {row(<><Label htmlFor="auth-identifier">{copy.emailOrUsername}</Label><Input id="auth-identifier" dir="ltr" autoComplete="username" required value={identifier} onChange={e => setIdentifier(e.target.value)} className="text-left" /></>)}
          {row(<><Label htmlFor="auth-password">{copy.password}</Label><Input id="auth-password" dir="ltr" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className="text-left" /></>)}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />{copy.remember}</label>
          <Button type="submit" className="h-11 w-full" disabled={busy}>{busy ? copy.working : copy.submitLogin}</Button>
          <Button type="button" variant="link" className="w-full" onClick={() => go("forgot-phone")}>{copy.forgot}</Button>
        </form>
      )}

      {view === "signup-email" && (
        <form onSubmit={submitSignup} className="space-y-3">
          {row(<><Label htmlFor="auth-name">{copy.name}</Label><Input id="auth-name" autoComplete="name" required value={name} onChange={e => setName(e.target.value)} /></>)}
          {row(<><Label htmlFor="auth-email">{copy.email}</Label><Input id="auth-email" dir="ltr" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className="text-left" /></>)}
          {row(<><Label htmlFor="auth-new-password">{copy.password}</Label><Input id="auth-new-password" dir="ltr" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} className="text-left" /></>)}
          <PhoneField id="auth-phone" dial={dial} local={local} onDial={setDial} onLocal={setLocal} label={copy.phone} codeLabel={copy.countryCode} />
          <p className="text-xs text-muted-foreground">{copy.phoneOptionalHint}</p>
          <DobSelect value={dob} onChange={setDob} label={copy.birthDate} />
          <Button type="submit" className="h-11 w-full bg-orange-500 text-white hover:bg-orange-600" disabled={busy}>{busy ? copy.working : copy.submitSignup}</Button>
        </form>
      )}

      {view === "forgot-phone" && (
        <form onSubmit={e => { e.preventDefault(); void sendForgot(); }} className="space-y-3">
          <p className="text-sm text-muted-foreground">{copy.forgotIntro}</p>
          <PhoneField id="auth-forgot-phone" dial={dial} local={local} onDial={setDial} onLocal={setLocal} label={copy.phone} codeLabel={copy.countryCode} required />
          <Button type="submit" className="h-11 w-full" disabled={busy || !phone}>{busy ? copy.working : copy.sendCode}</Button>
        </form>
      )}

      {view === "dev-signup" && (
        <form onSubmit={submitDeveloper} className="space-y-3" data-testid="developer-form">
          <p className="text-sm text-muted-foreground">{dev.intro}</p>
          {row(<><Label htmlFor="dev-email">{copy.email}</Label><Input id="dev-email" dir="ltr" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className="text-left" /></>)}
          {row(<><Label htmlFor="dev-username">{dev.username}</Label><Input id="dev-username" dir="ltr" autoComplete="username" required minLength={3} maxLength={20} value={username} onChange={e => setUsername(e.target.value)} className="text-left" /></>)}
          {row(<><Label htmlFor="dev-password">{copy.password}</Label><Input id="dev-password" dir="ltr" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} className="text-left" /></>)}
          <PhoneField id="dev-phone" dial={dial} local={local} onDial={setDial} onLocal={setLocal} label={copy.phone} codeLabel={copy.countryCode} required />
          <Button type="submit" className="h-11 w-full bg-orange-500 text-white hover:bg-orange-600" disabled={busy || !phone}>{busy ? copy.working : dev.submit}</Button>
        </form>
      )}
      {view === "dev-code" && codeBlock(dev.codeIntro(challenge?.masked ?? ""))}
      {view === "forgot-code" && codeBlock(copy.codeSentTo(challenge?.masked ?? ""))}
      {view === "device" && codeBlock(copy.deviceBody(challenge?.masked ?? ""))}
      {view === "phone-verify" && codeBlock(copy.phoneStepBody)}

      {view === "forgot-new" && (
        <form onSubmit={saveNewPassword} className="space-y-3">
          {row(<><Label htmlFor="auth-reset-password">{copy.newPassword}</Label><Input id="auth-reset-password" dir="ltr" type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={e => setNewPassword(e.target.value)} className="text-left" /></>)}
          <Button type="submit" className="h-11 w-full" disabled={busy}>{busy ? copy.working : copy.savePassword}</Button>
        </form>
      )}
      {onClose && null}
    </div>
  );
}
