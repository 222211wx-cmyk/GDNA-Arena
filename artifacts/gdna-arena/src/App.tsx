import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";

import { AuthProvider } from "@/contexts/AuthContext";
import { LangProvider } from "@/contexts/LangContext";
import { LegalProvider } from "@/contexts/LegalContext";
import { CallProvider } from "@/contexts/CallContext";
import CommHub from "@/components/CommHub";
import CookieBanner from "@/components/legal/CookieBanner";
import AgeGate from "@/components/legal/AgeGate";
import GeoBlock from "@/components/legal/GeoBlock";
import CoinsDisclaimer from "@/components/legal/CoinsDisclaimer";
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
import LegendsPage from "@/pages/legends";
import LegendHubPage from "@/pages/legend-hub";
import PulsePage from "@/pages/pulse";
import CitizensPage from "@/pages/citizens";
import CitizenPage from "@/pages/citizen";
import EmpireEternalPage from "@/pages/empire-eternal";
import LearnPage from "@/pages/learn";
import StoriesPage from "@/pages/stories";
import EventsPage from "@/pages/events";
import MessagesPage from "@/pages/messages";
import CelebrationsPage from "@/pages/celebrations";
import Hub from "@/pages/hub";
import Empire from "@/pages/empire";
import Legal from "@/pages/legal";
import Chronicle from "@/pages/chronicle";
import Welcome from "@/pages/welcome";
import SocialPage from "@/pages/social";
import InvitePage from "@/pages/invite";
import Growth from "@/pages/growth";
import PressPage from "@/pages/press";
import SportPage from "@/pages/sport";
import NeuralCorePage from "@/pages/neural-core";
import GenomePage from "@/pages/genome";
import { Footer } from "@/components/layout/footer";
import { GdnAiFloating } from "@/components/GdnAiTerminal";

const queryClient = new QueryClient();

function Router() {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground selection:bg-primary/30 selection:text-white">
      <CoinsDisclaimer />
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
          <Route path="/welcome" component={Welcome} />
          <Route path="/social" component={SocialPage} />
          <Route path="/invite" component={InvitePage} />
          <Route path="/growth" component={Growth} />
          <Route path="/sport" component={SportPage} />
          <Route path="/games" component={Games} />
          <Route path="/games/globalstar" component={GlobalStarApp} />
          <Route path="/games/globalstar/figures/:id" component={GlobalStarApp} />
          <Route path="/games/globalstar/:rest*" component={GlobalStarApp} />
          <Route path="/legends" component={LegendsPage} />
          <Route path="/legends/:id" component={LegendHubPage} />
          <Route path="/pulse" component={PulsePage} />
          <Route path="/citizens" component={CitizensPage} />
          <Route path="/citizen/:username" component={CitizenPage} />
          <Route path="/empire-eternal" component={EmpireEternalPage} />
          <Route path="/learn" component={LearnPage} />
          <Route path="/stories" component={StoriesPage} />
          <Route path="/events" component={EventsPage} />
          <Route path="/messages" component={MessagesPage} />
          <Route path="/celebrations" component={CelebrationsPage} />
          <Route path="/press" component={PressPage} />
          <Route path="/neural-core" component={NeuralCorePage} />
          <Route path="/genome" component={GenomePage} />
          <Route path="/news" component={NewsPage} />
          <Route path="/leaderboard" component={Leaderboard} />
          <Route path="/chat" component={ChatPage} />
          <Route path="/wallet" component={Wallet} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <Footer />
      <GdnAiFloating />
      <CookieBanner />
      <AgeGate />
      <GeoBlock />
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
          <LegalProvider>
            <AuthProvider>
              <CallProvider>
                <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                  <Router />
                </WouterRouter>
                <CommHub />
                <Toaster />
              </CallProvider>
            </AuthProvider>
          </LegalProvider>
        </LangProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
