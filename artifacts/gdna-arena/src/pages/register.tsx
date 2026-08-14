import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Input } from "@workspace/gdna-ds/components/ui/input";
import { Label } from "@workspace/gdna-ds/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/gdna-ds/components/ui/card";
import { Lock, Mail, User, AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export default function Register() {
  const [, setLocation] = useLocation();
  const { register, verifyEmail, resendCode } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<"form" | "verify">("form");
  const [code, setCode] = useState("");

  // Arriving from login with an unverified account (?verify=email)
  useEffect(() => {
    const pending = new URLSearchParams(window.location.search).get("verify");
    if (pending) {
      setEmail(pending);
      setInfo("أرسلنا كود التحقق إلى بريدك الإلكتروني — Code envoyé à votre email");
      setStep("verify");
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const result = await register(username, email, password);
      if (result.needsVerification) {
        setInfo(result.message ?? "أرسلنا كود التحقق إلى بريدك الإلكتروني");
        setStep("verify");
      } else {
        setLocation("/social");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      await verifyEmail(email, code);
      setLocation("/social");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");
    await resendCode(email);
    setInfo("تم إرسال كود جديد — Nouveau code envoyé");
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
            <CardTitle className="text-3xl font-black uppercase tracking-wider neon-text-glow">Join The Arena</CardTitle>
            <CardDescription className="text-muted-foreground uppercase tracking-widest text-xs">
              Create your player identity — start with 500 coins
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === "verify" ? (
              <form onSubmit={handleVerify} className="space-y-5">
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </div>
                )}
                {info && !error && (
                  <div className="p-3 rounded-md bg-primary/10 border border-primary/30 text-primary text-sm text-center">
                    {info}
                  </div>
                )}
                <p className="text-sm text-muted-foreground text-center">
                  📧 أدخل الكود المكوّن من 6 أرقام المرسل إلى <span className="text-primary font-semibold">{email}</span>
                </p>
                <div className="space-y-2">
                  <Label htmlFor="code" className="text-xs uppercase tracking-widest text-muted-foreground">Verification Code</Label>
                  <Input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    className="bg-background/50 border-primary/30 focus-visible:ring-primary/50 focus-visible:border-primary transition-all h-14 text-center text-2xl tracking-[0.5em] font-bold"
                    required
                    data-testid="input-verify-code"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full h-12 text-lg font-bold uppercase tracking-wider bg-primary hover:bg-primary/90 text-primary-foreground neon-glow transition-all duration-300"
                  disabled={isLoading || code.length !== 6}
                  data-testid="button-verify"
                >
                  {isLoading ? "Verifying..." : "✅ تأكيد الكود"}
                </Button>
                <button
                  type="button"
                  onClick={handleResend}
                  className="w-full text-center text-sm text-primary hover:underline"
                  data-testid="button-resend-code"
                >
                  ما وصلك الكود؟ إعادة الإرسال — Renvoyer le code
                </button>
              </form>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="username" className="text-xs uppercase tracking-widest text-muted-foreground">Player Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-5 w-5 text-primary/50" />
                  <Input
                    id="username"
                    type="text"
                    placeholder="CyberRacer99"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-10 bg-background/50 border-primary/30 focus-visible:ring-primary/50 focus-visible:border-primary transition-all h-12"
                    required
                    minLength={3}
                    maxLength={20}
                    data-testid="input-username"
                  />
                </div>
              </div>
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
                    autoComplete="new-password"
                    placeholder="min. 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 bg-background/50 border-primary/30 focus-visible:ring-primary/50 focus-visible:border-primary transition-all h-12"
                    required
                    minLength={6}
                    data-testid="input-password"
                  />
                </div>
              </div>
              <Button
                type="submit"
                className="w-full h-12 text-lg font-bold uppercase tracking-wider bg-primary hover:bg-primary/90 text-primary-foreground neon-glow transition-all duration-300"
                disabled={isLoading}
                data-testid="button-register"
              >
                {isLoading ? "Creating Account..." : "Enter The Arena"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Already a player?{" "}
                <Link href="/login" className="text-primary hover:underline font-semibold">
                  Login here
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
