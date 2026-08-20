import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import BotPanel from "@/components/BotPanel";

export default function FortressPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  if (!user) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center gap-5 px-6 text-center">
        <span className="text-6xl">🏰</span>
        <h1 className="text-3xl font-black">GDN-SMART FORTRESS</h1>
        <p className="text-muted-foreground">Sign in to meet the six autonomous Empire bots and receive your challenges.</p>
        <Button onClick={() => navigate("/login")}>Sign in</Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <header className="mb-8 rounded-2xl border border-primary/25 bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-4xl">🏰</span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">Empire intelligence division</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">GDN-SMART FORTRESS</h1>
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-muted-foreground">
          Six autonomous guardians are active. Their challenges rotate automatically after every Fortress update.
        </p>
      </header>
      <BotPanel />
    </main>
  );
}