import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@workspace/gdna-ds/components/ui/toaster";
import { TooltipProvider } from "@workspace/gdna-ds/components/ui/tooltip";
import { useEffect } from "react";

import { AuthProvider } from "@/contexts/AuthContext";
import { LangProvider } from "@/contexts/LangContext";
import { LegalProvider } from "@/contexts/LegalContext";
import { CallProvider } from "@/contexts/CallContext";
import { GroupCallProvider } from "@/contexts/GroupCallContext";
import { ConnectivityProvider } from "@/contexts/ConnectivityContext";
import { ConnectivityBanner } from "@/components/ConnectivityBanner";
import CookieBanner from "@/components/legal/CookieBanner";
import AgeGate from "@/components/legal/AgeGate";
import GeoBlock from "@/components/legal/GeoBlock";
import { Navbar } from "@/components/layout/navbar";
import Home from "@/pages/home";
import Login from "@/pages/login";
import Register from "@/pages/register";
import Dashboard from "@/pages/dashboard";
import Games from "@/pages/games";
import NeonRacerGame from "@/pages/game-neon-racer";
import CryptoClashGame from "@/pages/game-crypto-clash";
import ArenaStrikeGame from "@/pages/game-arena-strike";
import PenaltyKingGame from "@/pages/game-penalty-king";
import NewsPage from "@/pages/news";
import Leaderboard from "@/pages/leaderboard";
import ChatPage from "@/pages/chat";
import Wallet from "@/pages/wallet";
import NotFound from "@/pages/not-found";
import GlobalStarApp from "@/pages/globalstar-app";
import LegendsPage from "@/pages/legends";
import LegendHubPage from "@/pages/legend-hub";
import PulsePage from "@/pages/pulse";
import ClipsPage from "@/pages/clips";
import CitizensPage from "@/pages/citizens";
import CitizenPage from "@/pages/citizen";
import EmpireEternalPage from "@/pages/empire-eternal";
import LearnPage from "@/pages/learn";
import StoriesPage from "@/pages/stories";
import EventsPage from "@/pages/events";
import MessagesPage from "@/pages/messages";
import MissedCallsPage from "@/pages/missed-calls";
import CelebrationsPage from "@/pages/celebrations";
import Hub from "@/pages/hub";
import Empire from "@/pages/empire";
import Legal from "@/pages/legal";
import Chronicle from "@/pages/chronicle";
import Welcome from "@/pages/welcome";
import SocialPage  from "@/pages/social";
import InvitePage   from "@/pages/invite";
import Growth       from "@/pages/growth";
import AmeeqPage    from "@/pages/ameeq";
import PressPage    from "@/pages/press";
import SportPage    from "@/pages/sport";
import MusicPage    from "@/pages/music";
import ShopPage     from "@/pages/shop";
import FriendsPage  from "@/pages/friends";
import NeuralCorePage from "@/pages/neural-core";
import GenomePage from "@/pages/genome";
import SmartPage from "@/pages/smart";
import FortressPage from "@/pages/fortress";
import SearchPage from "@/pages/search";
import AmisPage from "@/pages/amis";
import { Footer } from "@/components/layout/footer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import CinemaPage   from "@/pages/cinema";
import AdminRevenuePage from "@/pages/admin-revenue";
import FinanceOnboarding from "@/pages/finance-onboarding";
import AdminFinance from "@/pages/admin-finance";
import AdminClipThumbnailsPage from "@/pages/admin-clip-thumbnails";
import RoyalVerificationPage from "@/pages/royal-verification";

const queryClient = new QueryClient();

function RealtimeQuerySync() {
  const client = useQueryClient();
  useEffect(() => {
    const refetch = () => {
      void client.invalidateQueries();
    };
    window.addEventListener("gdna:realtime-refetch", refetch);
    return () => window.removeEventListener("gdna:realtime-refetch", refetch);
  }, [client]);
  return null;
}

function PageWrapper() {
  const [location] = useLocation();
  return (
    <main key={location} className="flex-1 page-transition">
      <ErrorBoundary key={location}>
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
          <Route path="/social"   component={SocialPage}  />
          <Route path="/invite"   component={InvitePage}  />
          <Route path="/growth"   component={Growth}      />
          <Route path="/ameeq"    component={AmeeqPage}   />
          <Route path="/sport"    component={SportPage}   />
          <Route path="/music"    component={MusicPage}   />
          <Route path="/cinema"   component={CinemaPage}  />
          <Route path="/shop"     component={ShopPage}    />
          <Route path="/friends"  component={FriendsPage} />
          <Route path="/games" component={Games} />
          <Route path="/games/neon-racer" component={NeonRacerGame} />
          <Route path="/games/crypto-clash" component={CryptoClashGame} />
          <Route path="/games/arena-strike" component={ArenaStrikeGame} />
          <Route path="/games/penalty-king" component={PenaltyKingGame} />
          <Route path="/games/globalstar" component={GlobalStarApp} />
          <Route path="/games/globalstar/admin/withdrawals" component={GlobalStarApp} />
          <Route path="/games/globalstar/figures/:id" component={GlobalStarApp} />
          <Route path="/games/globalstar/:rest*" component={GlobalStarApp} />
          <Route path="/legends" component={LegendsPage} />
          <Route path="/legends/:id" component={LegendHubPage} />
          <Route path="/pulse" component={PulsePage} />
          <Route path="/clips" component={ClipsPage} />
          <Route path="/clip" component={ClipsPage} />
          <Route path="/citizens" component={CitizensPage} />
          <Route path="/citizen/:username" component={CitizenPage} />
          <Route path="/empire-eternal" component={EmpireEternalPage} />
          <Route path="/learn" component={LearnPage} />
          <Route path="/stories" component={StoriesPage} />
          <Route path="/events" component={EventsPage} />
          <Route path="/messages" component={MessagesPage} />
          <Route path="/missed-calls" component={MissedCallsPage} />
          <Route path="/celebrations" component={CelebrationsPage} />
          <Route path="/press" component={PressPage} />
          <Route path="/neural-core" component={NeuralCorePage} />
          <Route path="/genome" component={GenomePage} />
          <Route path="/smart" component={SmartPage} />
          <Route path="/fortress" component={FortressPage} />
          <Route path="/search" component={SearchPage} />
          <Route path="/amis" component={AmisPage} />
          <Route path="/news" component={NewsPage} />
          <Route path="/leaderboard" component={Leaderboard} />
          <Route path="/chat" component={ChatPage} />
          <Route path="/wallet" component={Wallet} />
          <Route path="/finance/onboarding" component={FinanceOnboarding} />
          <Route path="/royal-verification" component={RoyalVerificationPage} />
          <Route path="/admin/revenue" component={AdminRevenuePage} />
          <Route path="/admin/finance" component={AdminFinance} />
          <Route path="/admin/clips/thumbnails" component={AdminClipThumbnailsPage} />
          <Route component={NotFound} />
        </Switch>
      </ErrorBoundary>
    </main>
  );
}
function Router() {
  const [location] = useLocation();
  const isChoiceEntry = location === "/login";
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground selection:bg-primary/30 selection:text-white">
      {!isChoiceEntry && <Navbar />}
      <PageWrapper />
      {!isChoiceEntry && <Footer />}
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
      <RealtimeQuerySync />
      <TooltipProvider>
        <LangProvider>
          <ConnectivityProvider>
            <ConnectivityBanner />
            <LegalProvider>
              <AuthProvider>
                <CallProvider>
                  <GroupCallProvider>
                    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                      <Router />
                    </WouterRouter>
                    <Toaster />
                  </GroupCallProvider>
                </CallProvider>
              </AuthProvider>
            </LegalProvider>
          </ConnectivityProvider>
        </LangProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
