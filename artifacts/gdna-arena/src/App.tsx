import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";

import { AuthProvider } from "@/contexts/AuthContext";
import { LangProvider } from "@/contexts/LangContext";
import { Navbar } from "@/components/layout/navbar";
import Home from "@/pages/home";
import Login from "@/pages/login";
import Register from "@/pages/register";
import Dashboard from "@/pages/dashboard";
import Games from "@/pages/games";
import NewsPage from "@/pages/news";
import Leaderboard from "@/pages/leaderboard";
import ChatPage from "@/pages/chat";
import Wallet from "@/pages/wallet";
import NotFound from "@/pages/not-found";
import GlobalStarApp from "@/pages/globalstar-app";
import Hub from "@/pages/hub";
import Empire from "@/pages/empire";
import Legal from "@/pages/legal";
import Chronicle from "@/pages/chronicle";
import { Footer } from "@/components/layout/footer";
import { GdnAiFloating } from "@/components/GdnAiTerminal";

const queryClient = new QueryClient();

function Router() {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground selection:bg-primary/30 selection:text-white">
      <Navbar />
      <main className="flex-1">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/login" component={Login} />
          <Route path="/register" component={Register} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/hub" component={Hub} />
          <Route path="/empire" component={Empire} />
          <Route path="/legal" component={Legal} />
          <Route path="/legal/:tab" component={Legal} />
          <Route path="/chronicle" component={Chronicle} />
          <Route path="/games" component={Games} />
          <Route path="/games/globalstar" component={GlobalStarApp} />
          <Route path="/games/globalstar/:rest*" component={GlobalStarApp} />
          <Route path="/news" component={NewsPage} />
          <Route path="/leaderboard" component={Leaderboard} />
          <Route path="/chat" component={ChatPage} />
          <Route path="/wallet" component={Wallet} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <Footer />
      <GdnAiFloating />
    </div>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LangProvider>
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </AuthProvider>
        </LangProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
