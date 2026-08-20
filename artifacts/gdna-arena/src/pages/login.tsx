import { useState } from "react";
import { useLocation, Link } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Input } from "@workspace/gdna-ds/components/ui/input";
import { Label } from "@workspace/gdna-ds/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/gdna-ds/components/ui/card";
import { Lock, User, AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export default function Login() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      await login(username, password, rememberMe);
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
            <form onSubmit={handleSubmit} className="space-y-6">
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
                    placeholder="YourEmpireName"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-10 bg-background/50 border-primary/30 focus-visible:ring-primary/50 focus-visible:border-primary transition-all h-12"
                    required
                    autoComplete="username"
                    data-testid="input-username"
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
                    autoComplete="current-password"
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
              <p className="text-center text-sm text-muted-foreground">
                No account?{" "}
                <Link href="/register" className="text-primary hover:underline font-semibold">
                  Register here
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
