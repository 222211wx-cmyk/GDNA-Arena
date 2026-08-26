import { useEffect, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  Coins, AlertCircle, RefreshCw, ChevronRight, WifiOff,
  Clock, ShieldCheck, ShieldAlert, CircleDollarSign, Banknote,
  FlaskConical,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/gdna-ds/components/ui/card";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Badge } from "@workspace/gdna-ds/components/ui/badge";
import { Separator } from "@workspace/gdna-ds/components/ui/separator";
import { useAuth } from "@/contexts/AuthContext";
import { useConnectivity } from "@/contexts/ConnectivityContext";
import {
  useWalletData, useFinanceMode,
  type LedgerEntry, type Beneficiary,
} from "@/hooks/use-finance";

// ── Formatting ──────────────────────────────────────────────────────────────────
function fmtMinor(minor: number, currency: string): string {
  const code = (currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("fr-MA", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${code}`;
  }
}

function fmtTimestamp(ts: string): string {
  try {
    return new Intl.DateTimeFormat("fr-MA", { dateStyle: "short", timeStyle: "short" }).format(new Date(ts));
  } catch {
    return ts;
  }
}

// ── Simulation banner ───────────────────────────────────────────────────────────
function SimulationBanner() {
  const {simulation}=useFinanceMode();
  if (!simulation) return null;
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
      data-testid="banner-simulation-mode"
    >
      <FlaskConical className="w-4 h-4 text-primary shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="font-medium text-foreground">Test / Simulation Mode</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          All balances and payouts shown here are simulated. No real money is moved. Fiat
          settlement runs against Stripe test accounts only.
        </p>
      </div>
    </div>
  );
}

// ── Status badge ────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    completed: "default", settled: "default", paid: "default", simulated: "secondary",
    pending: "secondary", processing: "secondary", failed: "destructive", refunded: "outline",
  };
  return <Badge variant={map[status.toLowerCase()] ?? "outline"}>{status}</Badge>;
}

// ── Beneficiary capability card ─────────────────────────────────────────────────
function BeneficiaryCard({ b }: { b: Beneficiary }) {
  const canPayout = b.canPayout && b.chargesEnabled && b.payoutsEnabled;
  return (
    <div className="rounded-lg border border-border/50 bg-card/30 p-4 space-y-3" data-testid={`card-beneficiary-${b.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm text-foreground" data-testid={`text-beneficiary-name-${b.id}`}>
            {b.displayName}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 uppercase tracking-wide">
            {b.ownerType}{b.country ? ` · ${b.country}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {canPayout
            ? <ShieldCheck className="w-4 h-4 text-green-500" />
            : <ShieldAlert className="w-4 h-4 text-orange-400" />}
          <span className={`text-xs font-medium ${canPayout ? "text-green-500" : "text-orange-400"}`}>
            {canPayout ? "Active" : "Restricted"}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span className={`w-2 h-2 rounded-full ${b.chargesEnabled ? "bg-green-500" : "bg-muted-foreground/40"}`} />
          Charges {b.chargesEnabled ? "enabled" : "disabled"}
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span className={`w-2 h-2 rounded-full ${b.payoutsEnabled ? "bg-green-500" : "bg-muted-foreground/40"}`} />
          Payouts {b.payoutsEnabled ? "enabled" : "disabled"}
        </div>
        {b.termsAccepted && (
          <div className="col-span-2 flex items-center gap-1.5 text-muted-foreground">
            <ShieldCheck className="w-3 h-3 text-green-500" />
            Terms accepted{b.termsVersion ? ` (${b.termsVersion})` : ""}
          </div>
        )}
      </div>
      {b.requirementsDue.length > 0 && (
        <div className="rounded-md bg-orange-500/10 border border-orange-500/30 px-3 py-2">
          <p className="text-xs font-medium text-orange-400 mb-1">Requirements due</p>
          <ul className="space-y-0.5">
            {b.requirementsDue.map((r) => <li key={r} className="text-xs text-orange-300/80">{r}</li>)}
          </ul>
        </div>
      )}
      {b.restrictionReason && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2">
          <p className="text-xs text-destructive">{b.restrictionReason}</p>
        </div>
      )}
      <Link href="/finance/onboarding">
        <Button size="sm" variant="outline" className="w-full mt-1" data-testid={`button-manage-beneficiary-${b.id}`}>
          {b.canPayout ? "Manage account" : "Complete setup"} <ChevronRight className="w-3 h-3 ml-1" />
        </Button>
      </Link>
    </div>
  );
}

// ── Ledger entry row ────────────────────────────────────────────────────────────
function LedgerRow({ entry }: { entry: LedgerEntry }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/30 last:border-0" data-testid={`row-ledger-entry-${entry.id}`}>
      <div className="w-8 h-8 rounded-full bg-background flex items-center justify-center border border-border/40 shrink-0 mt-0.5">
        <Banknote className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-foreground">{entry.type}</span>
          {entry.immutable && <Badge variant="outline" className="text-[10px] px-1.5 py-0">immutable</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate" data-testid={`text-ledger-ref-${entry.id}`}>
          Ref: {entry.id}
        </p>
        <p className="text-xs text-muted-foreground/60 mt-0.5 flex items-center gap-1">
          <Clock className="w-3 h-3" />{fmtTimestamp(entry.createdAt)}
        </p>
      </div>
      <span className="font-semibold text-sm shrink-0 mt-0.5 tabular-nums" data-testid={`text-ledger-amount-${entry.id}`}>
        {fmtMinor(entry.amountMinor, entry.currency)}
      </span>
    </div>
  );
}

// ── Skeleton ────────────────────────────────────────────────────────────────────
function WalletSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="skeleton h-28 rounded-xl" />
      <div className="grid grid-cols-2 gap-3">
        <div className="skeleton h-20 rounded-xl" />
        <div className="skeleton h-20 rounded-xl" />
      </div>
      <div className="skeleton h-48 rounded-xl" />
    </div>
  );
}

// ── Guest ───────────────────────────────────────────────────────────────────────
function GuestWallet() {
  return (
    <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full text-center">
        <Card className="bg-card/50 border-primary/20">
          <CardContent className="p-10 space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
              <Coins className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Your Wallet</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Sign in to see your balance, fiat account, and transaction history.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Link href="/login">
                <Button className="w-full" data-testid="button-login-wallet">Log in to access wallet</Button>
              </Link>
              <Link href="/register">
                <Button variant="outline" className="w-full" data-testid="button-register-wallet">Create a free account</Button>
              </Link>
            </div>
            <p className="text-xs text-muted-foreground/60 border-t border-border/30 pt-4">
              Arena Qaisypro coins are virtual credits with no monetary value and cannot be exchanged for cash.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────────
export default function Wallet() {
  const { user } = useAuth();
  const { isOnline } = useConnectivity();
  const { state, refetch } = useWalletData();
  const [activeTab, setActiveTab] = useState<"coins" | "fiat">("coins");

  useEffect(() => {
    if (user) refetch();
  }, [user, refetch]);

  if (!user) return <GuestWallet />;

  const isLoading = state.status === "idle" || state.status === "loading";
  const isError = state.status === "error";
  const data = state.status === "success" ? state.data : null;

  const coinBalance = data?.coins?.balance ?? data?.coinBalance ?? 0;
  const fiat = data?.fiat ?? null;
  const entries = data?.entries ?? [];
  const beneficiaries = data?.beneficiaries ?? [];
  const canAnyPayout = beneficiaries.some((b) => b.canPayout);

  return (
    <div className="min-h-[calc(100dvh-4rem)] max-w-3xl mx-auto px-4 py-6 md:py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Wallet</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Your coins and fiat account</p>
        </div>
        <Button
          variant="ghost" size="sm" onClick={() => refetch()}
          disabled={!isOnline || isLoading} data-testid="button-refresh-wallet"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          <span className="sr-only">Refresh</span>
        </Button>
      </div>

      <SimulationBanner />

      {!isOnline && (
        <div className="flex items-center gap-2 rounded-lg bg-orange-500/10 border border-orange-500/30 px-4 py-2.5 text-sm text-orange-400">
          <WifiOff className="w-4 h-4 shrink-0" />
          You are offline. Wallet data may be stale and actions are disabled.
        </div>
      )}

      {isError && !isLoading && (
        <div className="flex items-center gap-3 rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
          <p className="text-sm text-destructive flex-1">{(state as { status: "error"; error: string }).error}</p>
          <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-retry-wallet">Retry</Button>
        </div>
      )}

      {isLoading && <WalletSkeleton />}

      {!isLoading && data && (
        <>
          {/* Tab selector */}
          <div className="flex gap-1 p-1 rounded-lg bg-muted/40 border border-border/30" role="tablist">
            <button
              role="tab" aria-selected={activeTab === "coins"} onClick={() => setActiveTab("coins")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === "coins"
                  ? "bg-background text-foreground shadow-sm border border-border/50"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="tab-coins"
            >
              <Coins className="w-4 h-4" /> Game Coins
            </button>
            <button
              role="tab" aria-selected={activeTab === "fiat"} onClick={() => setActiveTab("fiat")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === "fiat"
                  ? "bg-background text-foreground shadow-sm border border-border/50"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="tab-fiat"
            >
              <CircleDollarSign className="w-4 h-4" /> Fiat Account
            </button>
          </div>

          {/* COINS TAB */}
          {activeTab === "coins" && (
            <motion.div key="coins" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg bg-muted/30 border border-border/30 px-3 py-2 text-xs text-muted-foreground">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Arena Qaisypro coins are virtual credits with no monetary value and cannot be redeemed for cash.
              </div>
              <Card className="bg-card/50 border-primary/20">
                <CardContent className="p-6 flex flex-col items-center text-center">
                  <Coins className="w-10 h-10 text-primary mb-3" />
                  <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Coin Balance</p>
                  <p className="text-4xl font-black text-primary neon-text-glow tabular-nums" data-testid="text-wallet-balance">
                    {coinBalance.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 uppercase tracking-widest">
                    Coins — virtual, no cash value
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* FIAT TAB */}
          {activeTab === "fiat" && (
            <motion.div key="fiat" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              {fiat ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[
                      { label: "Available", value: fiat.available, color: "text-green-500", testId: "text-fiat-available" },
                      { label: "Pending", value: fiat.pending, color: "text-orange-400", testId: "text-fiat-pending" },
                      { label: "Reserved", value: fiat.reserved, color: "text-muted-foreground", testId: "text-fiat-reserved" },
                      { label: "Paid Out", value: fiat.paid, color: "text-primary", testId: "text-fiat-paid" },
                      { label: "Total Income", value: fiat.income, color: "text-green-500", testId: "text-fiat-income" },
                      { label: "Total Expense", value: fiat.expense, color: "text-destructive", testId: "text-fiat-expense" },
                    ].map((item) => (
                      <Card key={item.label} className="bg-card/40 border-border/30">
                        <CardContent className="p-4">
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{item.label}</p>
                          <p className={`text-lg font-bold tabular-nums ${item.color}`} data-testid={item.testId}>
                            {fmtMinor(item.value, fiat.currency)}
                          </p>
                          <p className="text-xs text-muted-foreground/50 mt-0.5 uppercase">{fiat.currency}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {canAnyPayout && fiat.available > 0 && (
                    <div className="flex items-center justify-between rounded-lg bg-green-500/10 border border-green-500/30 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-green-400">Payout available (simulated)</p>
                        <p className="text-xs text-green-400/70 mt-0.5">
                          {fmtMinor(fiat.available, fiat.currency)} ready to transfer
                        </p>
                      </div>
                      <Link href="/finance/onboarding">
                        <Button size="sm" data-testid="button-initiate-payout">Request payout</Button>
                      </Link>
                    </div>
                  )}

                  <Card className="bg-card/40 border-border/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm uppercase tracking-widest text-muted-foreground">
                        Immutable Ledger Entries
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      {entries.length === 0 ? (
                        <div className="py-8 text-center">
                          <Banknote className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                          <p className="text-sm text-muted-foreground">No ledger entries yet.</p>
                        </div>
                      ) : (
                        <div>{entries.map((entry) => <LedgerRow key={entry.id} entry={entry} />)}</div>
                      )}
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card className="bg-card/40 border-border/30">
                  <CardContent className="p-10 text-center space-y-4">
                    <div className="w-14 h-14 rounded-full bg-muted/30 border border-border/40 flex items-center justify-center mx-auto">
                      <CircleDollarSign className="w-7 h-7 text-muted-foreground/50" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">No fiat account yet</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Complete beneficiary onboarding to simulate payouts through Stripe test mode.
                      </p>
                    </div>
                    <Link href="/finance/onboarding">
                      <Button data-testid="button-start-onboarding">
                        Set up payout account <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              )}

              {beneficiaries.length > 0 && (
                <div className="space-y-2">
                  <Separator />
                  <h3 className="text-xs uppercase tracking-widest text-muted-foreground pt-2">Payout Accounts</h3>
                  <div className="space-y-2">
                    {beneficiaries.map((b) => <BeneficiaryCard key={b.id} b={b} />)}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
