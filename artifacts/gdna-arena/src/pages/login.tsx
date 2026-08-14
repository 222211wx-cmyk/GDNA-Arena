import { useState } from "react";
import { useLocation, Link } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Input } from "@workspace/gdna-ds/components/ui/input";
import { Label } from "@workspace/gdna-ds/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/gdna-ds/components/ui/card";
import { Lock, Mail, AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export default function Login() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [mode, setMode] = useState<"login" | "forgot" | "reset">("login");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setInfo(data.message ?? "تم إرسال الكود إلى بريدك");
      setMode("reset");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, code, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      window.location.href = "/social"; // logged in — full reload picks up session
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const result = await login(email, password, rememberMe);
      if (result.needsVerification) {
        setLocation(`/register?verify=${encodeURIComponent(email)}`);
        return;
      }
      setLocation("/social");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vw] max-w-[600px] max-h-[600px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md z-10"
      >
        <Card className="bg-card/50 backdrop-blur-sm border-primary/20 shadow-[0_0_50px_rgba(0,212,255,0.1)]">
          <CardHeader className="space-y-1 text-center pb-8">
            <CardTitle className="text-3xl font-black uppercase tracking-wider neon-text-glow">Access Terminal</CardTitle>
            <CardDescription className="text-muted-foreground uppercase tracking-widest text-xs">
              Authenticate to enter the arena
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mode === "forgot" ? (
              <form onSubmit={handleForgot} className="space-y-6">
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </div>
                )}
                <p className="text-sm text-muted-foreground text-center">
                  🔑 أدخل بريدك الإلكتروني وغادي نرسلو لك كود الاسترجاع
                </p>
                <div className="space-y-2">
                  <Label htmlFor="forgot-email" className="text-xs uppercase tracking-widest text-muted-foreground">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-5 w-5 text-primary/50" />
                    <Input
                      id="forgot-email"
                      type="email"
                      placeholder="player@gdna.network"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10 bg-background/50 border-primary/30 focus-visible:ring-primary/50 focus-visible:border-primary transition-all h-12"
                      required
                      data-testid="input-forgot-email"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full h-12 text-lg font-bold uppercase tracking-wider bg-primary hover:bg-primary/90 text-primary-foreground neon-glow" disabled={isLoading} data-testid="button-send-reset">
                  {isLoading ? "Sending..." : "📧 إرسال الكود"}
                </Button>
                <button type="button" onClick={() => { setMode("login"); setError(""); }} className="w-full text-center text-sm text-primary hover:underline">
                  الرجوع لتسجيل الدخول — Retour
                </button>
              </form>
            ) : mode === "reset" ? (
              <form onSubmit={handleReset} className="space-y-6">
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </div>
                )}
                {info && !error && (
                  <div className="p-3 rounded-md bg-primary/10 border border-primary/30 text-primary text-sm text-center">{info}</div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="reset-code" className="text-xs uppercase tracking-widest text-muted-foreground">Code</Label>
                  <Input
                    id="reset-code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    className="bg-background/50 border-primary/30 h-14 text-center text-2xl tracking-[0.5em] font-bold"
                    required
                    data-testid="input-reset-code"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password" className="text-xs uppercase tracking-widest text-muted-foreground">New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-5 w-5 text-primary/50" />
                    <Input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="كلمة السر الجديدة (6+ أحرف)"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="pl-10 bg-background/50 border-primary/30 h-12"
                      required
                      minLength={6}
                      data-testid="input-new-password"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full h-12 text-lg font-bold uppercase tracking-wider bg-primary hover:bg-primary/90 text-primary-foreground neon-glow" disabled={isLoading || code.length !== 6} data-testid="button-reset-password">
                  {isLoading ? "..." : "🔐 تغيير كلمة السر والدخول"}
                </Button>
                <button type="button" onClick={handleForgot} className="w-full text-center text-sm text-primary hover:underline">
                  ما وصلك الكود؟ إعادة الإرسال — Renvoyer
                </button>
              </form>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs uppercase tracking-widest text-muted-foreground">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-5 w-5 text-primary/50" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="player@gdna.network"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 bg-background/50 border-primary/30 focus-visible:ring-primary/50 focus-visible:border-primary transition-all h-12"
                    required
                    data-testid="input-email"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-xs uppercase tracking-widest text-muted-foreground">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-5 w-5 text-primary/50" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 bg-background/50 border-primary/30 focus-visible:ring-primary/50 focus-visible:border-primary transition-all h-12"
                    required
                    data-testid="input-password"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-muted-foreground" data-testid="checkbox-remember-me">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 accent-primary cursor-pointer"
                />
                <span>تذكرني — Se souvenir de moi</span>
              </label>
              <Button
                type="submit"
                className="w-full h-12 text-lg font-bold uppercase tracking-wider bg-primary hover:bg-primary/90 text-primary-foreground neon-glow transition-all duration-300"
                disabled={isLoading}
                data-testid="button-login"
              >
                {isLoading ? "Authenticating..." : "Login"}
              </Button>
              <button
                type="button"
                onClick={() => { setMode("forgot"); setError(""); }}
                className="w-full text-center text-sm text-primary hover:underline"
                data-testid="button-forgot-password"
              >
                نسيت كلمة السر؟ — Mot de passe oublié ?
              </button>
              <p className="text-center text-sm text-muted-foreground">
                No account?{" "}
                <Link href="/register" className="text-primary hover:underline font-semibold">
                  Register here
                </Link>
              </p>
            </form>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
