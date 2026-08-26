import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight, ChevronLeft, AlertCircle, CheckCircle2,
  WifiOff, Loader2, ExternalLink, RefreshCw, ShieldCheck,
  Building2, User, Briefcase, FlaskConical, Calculator,
  Landmark, Send, Eye, EyeOff,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/gdna-ds/components/ui/card";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Input } from "@workspace/gdna-ds/components/ui/input";
import { Label } from "@workspace/gdna-ds/components/ui/label";
import { Badge } from "@workspace/gdna-ds/components/ui/badge";
import { Separator } from "@workspace/gdna-ds/components/ui/separator";
import { useToast } from "@workspace/gdna-ds/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useConnectivity } from "@/contexts/ConnectivityContext";
import {
  useWalletData, useManualPayouts,
  postAcceptTerms, postOnboarding, postRefresh,
  postSimulatePayment, postSimulateRefund,
  putPayoutDetails, postManualPayout,
  splitNet7030, newIdempotencyKey,
  CURRENT_TERMS_VERSION, useFinanceMode,
  type Beneficiary, type SimulationPayment, type PayoutDetails, type ManualPayoutRequest,
} from "@/hooks/use-finance";

// ── Settlement terms — exact copy (version aligned to backend) ─────────────────
const NET_SETTLEMENT_TERMS = `Net-Settlement Terms — Arena Qaisypro (v${CURRENT_TERMS_VERSION})

1. Revenue Split
   Platform fee: 30% of each gross transaction.
   Beneficiary net settlement: 70% of each gross transaction.
   These percentages are calculated on gross amounts before any applicable taxes.

2. Test / Simulation Mode (Beta)
   This release operates in Test / Simulation Mode. No real money is moved.
   Stripe Connect runs against Stripe test accounts only, and any 70/30 figures
   shown are simulated calculations for beta verification purposes only.

3. Payout Processing
   Payouts are processed via Stripe Connect Express (live) or the monthly manual
   RedotPay request flow (event/company beneficiaries).
   The platform does not collect, store, or process raw bank or card details locally.
   Bank account numbers are encrypted server-side and only the masked form is
   returned to the client.

4. Currency and Settlement
   Settlements are issued in the currency of your payout account.
   No exchange rate guarantees are made.

5. Timing
   Payouts are subject to payout schedule and any applicable holding periods.
   The platform reserves the right to delay payouts pending compliance or fraud review.

6. Restrictions
   Payouts require account activation and all due requirements to be satisfied.

7. No Liability for Provider Downtime
   The platform is not liable for delays or failures caused by Stripe Inc.,
   RedotPay, or third-party banking networks.

By clicking "I accept these terms", you confirm that you have read, understood,
and agree to these terms.`;

// ── Owner type options ─────────────────────────────────────────────────────────
const OWNER_TYPES = [
  { value: "citizen",  label: "Citizen",  description: "Individual creator or player", icon: User },
  { value: "event",    label: "Event",    description: "Event organizer or promoter",  icon: Briefcase },
  { value: "company",  label: "Company",  description: "Legal entity or business",     icon: Building2 },
] as const;

const COUNTRIES = [
  { code: "MA", name: "Morocco" },
  { code: "FR", name: "France" },
  { code: "BE", name: "Belgium" },
  { code: "DE", name: "Germany" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "AE", name: "United Arab Emirates" },
];

type Step = "owner-type" | "details" | "terms" | "stripe" | "complete";

interface FormState {
  ownerType: string;
  displayName: string;
  legalName: string;
  country: string;
  termsAccepted: boolean;
}

// ── Formatting ──────────────────────────────────────────────────────────────────
function fmtMinor(minor: number, currency: string): string {
  const code = (currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("fr-MA", { style: "currency", currency: code, minimumFractionDigits: 2 }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${code}`;
  }
}

// ── Step indicator ─────────────────────────────────────────────────────────────
const STEPS: { key: Step; label: string }[] = [
  { key: "owner-type", label: "Account type" },
  { key: "details",    label: "Details" },
  { key: "terms",      label: "Terms" },
  { key: "stripe",     label: "Connect" },
];

function StepIndicator({ current }: { current: Step }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, i) => (
        <div key={step.key} className="flex items-center">
          <div className="flex items-center gap-1.5">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border transition-colors ${
              i < currentIdx ? "bg-primary border-primary text-primary-foreground"
              : i === currentIdx ? "border-primary text-primary bg-primary/10"
              : "border-border/40 text-muted-foreground/40"
            }`}>
              {i < currentIdx ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span className={`text-xs hidden sm:inline ${i === currentIdx ? "text-foreground font-medium" : "text-muted-foreground/60"}`}>
              {step.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-6 sm:w-10 h-px mx-1 ${i < currentIdx ? "bg-primary" : "bg-border/30"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Existing beneficiary panel ─────────────────────────────────────────────────
function ExistingBeneficiaryPanel({ b, onRefresh, isRefreshing }: {
  b: Beneficiary; onRefresh: () => void; isRefreshing: boolean;
}) {
  const canPayout = b.canPayout && b.chargesEnabled && b.payoutsEnabled;
  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Payout Account</CardTitle>
          <Badge variant={canPayout ? "default" : "secondary"}>{canPayout ? "Active" : "Incomplete"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div><p className="text-xs text-muted-foreground">Display name</p><p className="font-medium">{b.displayName}</p></div>
          <div><p className="text-xs text-muted-foreground">Account type</p><p className="font-medium capitalize">{b.ownerType}</p></div>
          <div><p className="text-xs text-muted-foreground">Country</p><p className="font-medium">{b.country ?? "—"}</p></div>
          <div>
            <p className="text-xs text-muted-foreground">Terms</p>
            <p className={`font-medium text-xs ${b.termsAccepted ? "text-green-500" : "text-orange-400"}`}>
              {b.termsAccepted ? `Accepted (${b.termsVersion ?? "?"})` : "Not accepted"}
            </p>
          </div>
        </div>
        <Separator />
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${b.chargesEnabled ? "bg-green-500" : "bg-muted-foreground/30"}`} />
            <span className="text-muted-foreground">Charges {b.chargesEnabled ? "enabled" : "disabled"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${b.payoutsEnabled ? "bg-green-500" : "bg-muted-foreground/30"}`} />
            <span className="text-muted-foreground">Payouts {b.payoutsEnabled ? "enabled" : "disabled"}</span>
          </div>
        </div>
        {b.requirementsDue.length > 0 && (
          <div className="rounded-md bg-orange-500/10 border border-orange-500/30 px-3 py-2 space-y-1">
            <p className="text-xs font-medium text-orange-400">Requirements due:</p>
            {b.requirementsDue.map((r) => <p key={r} className="text-xs text-orange-300/80">{r}</p>)}
          </div>
        )}
        {b.restrictionReason && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2">
            <p className="text-xs font-medium text-destructive">Restriction</p>
            <p className="text-xs text-destructive/80 mt-0.5">{b.restrictionReason}</p>
          </div>
        )}
        <Button variant="outline" className="w-full" onClick={onRefresh} disabled={isRefreshing} data-testid="button-refresh-onboarding">
          {isRefreshing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Refreshing...</> : <><RefreshCw className="w-4 h-4 mr-2" />Resume Stripe onboarding</>}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── 70/30 split simulation panel — calls real backend endpoint ──────────────────
function SplitSimulationPanel({ beneficiary }: { beneficiary: Beneficiary | null }) {
  const { toast } = useToast();
  const { refetch: refetchWallet } = useWalletData();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("usd");
  const [description, setDescription] = useState("Simulation payment");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [lastPayment, setLastPayment] = useState<SimulationPayment | null>(null);
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const { isOnline } = { isOnline: true }; // resolved from context below

  const amountMinor = Math.round(Number(amount) * 100);
  const valid = Number.isSafeInteger(amountMinor) && amountMinor > 0 && !!beneficiary;
  const preview = valid ? splitNet7030(amountMinor) : { beneficiaryMinor: 0, platformMinor: 0 };

  async function runSimulation() {
    if (!valid || !beneficiary) return;
    setSubmitting(true);
    setError("");
    try {
      const { payment } = await postSimulatePayment({
        beneficiaryId: beneficiary.id,
        amountMinor,
        currency,
        description: description.trim() || "Simulation payment",
        idempotencyKey: newIdempotencyKey("sim-pay"),
      });
      setLastPayment(payment);
      toast({ title: "Simulation payment recorded", description: `Journal ID: ${payment.journalId ?? payment.id}` });
      await refetchWallet();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function runRefund() {
    if (!lastPayment?.journalId) return;
    setRefundSubmitting(true);
    setError("");
    try {
      await postSimulateRefund({
        journalId: lastPayment.journalId,
        idempotencyKey: newIdempotencyKey("sim-refund"),
      });
      toast({ title: "Simulation refund recorded", description: "Ledger reversal created." });
      setLastPayment(null);
      await refetchWallet();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refund failed");
    } finally {
      setRefundSubmitting(false);
    }
  }

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="w-4 h-4 text-primary" /> 70 / 30 Split Simulation
          </CardTitle>
          <Badge variant="secondary">Simulated — no money moved</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Runs a persisted simulation payment through the backend ledger. Calculates the 70/30
          split and records it as a journal entry on the server. No real money is transferred.
        </p>
        {!beneficiary && (
          <div className="rounded-md bg-muted/20 border border-border/30 px-3 py-2 text-xs text-muted-foreground">
            A beneficiary account is required to run simulation payments.
          </div>
        )}
        <div className="flex gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="sim-amount">Gross amount</Label>
            <Input
              id="sim-amount" type="number" min="0" step="0.01" inputMode="decimal"
              value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="100.00" data-testid="input-sim-amount"
            />
          </div>
          <div className="w-28 space-y-1.5">
            <Label htmlFor="sim-currency">Currency</Label>
            <select
              id="sim-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}
              data-testid="select-sim-currency"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {["usd", "eur", "mad", "gbp"].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sim-description">Description</Label>
          <Input
            id="sim-description" value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Simulation payment" data-testid="input-sim-description"
          />
        </div>

        {/* Live preview */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2">
            <p className="text-xs text-muted-foreground">Beneficiary (70%)</p>
            <p className="text-lg font-bold text-green-500 tabular-nums" data-testid="text-sim-beneficiary">
              {fmtMinor(preview.beneficiaryMinor, currency)}
            </p>
          </div>
          <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
            <p className="text-xs text-muted-foreground">Platform (30%)</p>
            <p className="text-lg font-bold text-foreground tabular-nums" data-testid="text-sim-platform">
              {fmtMinor(preview.platformMinor, currency)}
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}

        <Button
          className="w-full" disabled={!valid || submitting}
          onClick={runSimulation} data-testid="button-run-simulation"
        >
          {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running...</> : "Post simulation payment"}
        </Button>

        {/* Last result + refund */}
        {lastPayment && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-3 space-y-2">
            <p className="text-xs font-medium text-foreground">Last simulation result</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span className="text-muted-foreground">Journal ID</span>
              <span className="font-mono truncate" data-testid="text-sim-journal-id">{lastPayment.journalId ?? lastPayment.id}</span>
              <span className="text-muted-foreground">Beneficiary</span>
              <span className="text-green-500 tabular-nums">{fmtMinor(lastPayment.beneficiaryMinor ?? 0, lastPayment.currency)}</span>
              <span className="text-muted-foreground">Platform</span>
              <span className="tabular-nums">{fmtMinor(lastPayment.platformMinor ?? 0, lastPayment.currency)}</span>
              <span className="text-muted-foreground">Duplicate</span>
              <span>{lastPayment.duplicate ? "Yes (idempotent)" : "No"}</span>
            </div>
            {lastPayment.journalId && (
              <Button
                variant="outline" size="sm" className="w-full mt-1"
                disabled={refundSubmitting} onClick={runRefund}
                data-testid="button-run-refund"
              >
                {refundSubmitting ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Refunding...</> : "Post refund (ledger reversal)"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Bank details + monthly RedotPay request panel ──────────────────────────────
// Only for event/company beneficiaries.
function PayoutRailsPanel({ beneficiary, requestsEnabled }: { beneficiary: Beneficiary; requestsEnabled:boolean }) {
  const { toast } = useToast();
  const { state: manualState, refetch: refetchManual } = useManualPayouts();

  // Payout details form
  const [maskedAccount, setMaskedAccount] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [detailsForm, setDetailsForm] = useState({ accountHolder: "", bankName: "", accountNumber: "", routingCode: "" });
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState("");

  // Manual payout request form
  const [reqCurrency, setReqCurrency] = useState("usd");
  const [submittingReq, setSubmittingReq] = useState(false);
  const [reqError, setReqError] = useState("");

  const period = new Date().toISOString().slice(0, 7); // YYYY-MM

  useEffect(() => { refetchManual(); }, [refetchManual]);

  const requests = (manualState.status === "success" ? manualState.data : [])
    .filter((r) => r.beneficiaryId === beneficiary.id);
  const alreadyRequested = requests.some((r) => r.period === period);
  const hasDetails = !!maskedAccount;

  async function saveDetails() {
    if (!detailsForm.accountHolder.trim() || !detailsForm.accountNumber.trim() || !detailsForm.bankName.trim()) return;
    setSavingDetails(true);
    setDetailsError("");
    try {
      const { payoutDetails } = await putPayoutDetails(beneficiary.id, {
        accountHolder: detailsForm.accountHolder.trim(),
        bankName: detailsForm.bankName.trim(),
        accountNumber: detailsForm.accountNumber.trim(),
        routingCode: detailsForm.routingCode.trim() || undefined,
      });
      setMaskedAccount(payoutDetails.maskedAccount);
      setEditing(false);
      setReveal(false);
      toast({ title: "Bank details saved", description: "Account number encrypted server-side. Only the masked form is returned." });
    } catch (e) {
      setDetailsError(e instanceof Error ? e.message : "Failed to save details");
    } finally {
      setSavingDetails(false);
    }
  }

  async function submitManualPayout() {
    setSubmittingReq(true);
    setReqError("");
    try {
      await postManualPayout({ beneficiaryId: beneficiary.id, period, currency: reqCurrency });
      toast({ title: "Monthly payout request submitted", description: `RedotPay manual request for ${period} is now pending admin review.` });
      await refetchManual();
    } catch (e) {
      setReqError(e instanceof Error ? e.message : "Failed to submit payout request");
    } finally {
      setSubmittingReq(false);
    }
  }

  const statusVariant: Record<ManualPayoutRequest["status"], "default" | "secondary" | "destructive" | "outline"> = {
    pending: "secondary", approved: "default", rejected: "destructive", paid: "default",
  };

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="w-4 h-4 text-primary" /> Bank Details &amp; RedotPay
          </CardTitle>
          <Badge variant="secondary">Monthly manual</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* Bank details section */}
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Settlement bank details</p>
          <p className="text-xs text-muted-foreground">
            Account numbers are encrypted server-side. Only the masked form (••••XXXX) is returned
            to the client — the full number is never exposed after submission.
          </p>

          {!editing && maskedAccount && (
            <div className="rounded-lg border border-border/40 bg-card/30 p-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs">Account (masked)</span>
                <span className="font-mono flex items-center gap-2" data-testid="text-masked-account">
                  {reveal ? detailsForm.accountNumber || maskedAccount : maskedAccount}
                  <button
                    onClick={() => setReveal((r) => !r)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={reveal ? "Hide" : "Reveal masked account"}
                    data-testid="button-toggle-reveal"
                  >
                    {reveal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </span>
              </div>
              <Button variant="outline" size="sm" className="w-full mt-1" onClick={() => setEditing(true)} data-testid="button-edit-bank">
                Update bank details
              </Button>
            </div>
          )}

          {!editing && !maskedAccount && (
            <Button variant="outline" className="w-full" onClick={() => setEditing(true)} data-testid="button-add-bank">
              Add bank details
            </Button>
          )}

          {editing && (
            <div className="space-y-2.5">
              <div className="space-y-1.5">
                <Label htmlFor="bank-holder">Account holder name</Label>
                <Input id="bank-holder" value={detailsForm.accountHolder}
                  onChange={(e) => setDetailsForm((f) => ({ ...f, accountHolder: e.target.value }))}
                  placeholder="Legal name on account" data-testid="input-bank-holder" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bank-name">Bank name</Label>
                <Input id="bank-name" value={detailsForm.bankName}
                  onChange={(e) => setDetailsForm((f) => ({ ...f, bankName: e.target.value }))}
                  placeholder="Bank name" data-testid="input-bank-name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bank-account">Account number / IBAN</Label>
                <Input id="bank-account" value={detailsForm.accountNumber}
                  onChange={(e) => setDetailsForm((f) => ({ ...f, accountNumber: e.target.value }))}
                  placeholder="MA64 0000 0000 0000 0000 0000" data-testid="input-bank-account" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bank-routing">Routing code / SWIFT (optional)</Label>
                <Input id="bank-routing" value={detailsForm.routingCode}
                  onChange={(e) => setDetailsForm((f) => ({ ...f, routingCode: e.target.value }))}
                  placeholder="BANKMAMC" data-testid="input-bank-routing" />
              </div>
              {detailsError && (
                <div className="flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                  <p className="text-xs text-destructive">{detailsError}</p>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setEditing(false); setDetailsError(""); }} data-testid="button-cancel-bank">Cancel</Button>
                <Button
                  className="flex-1"
                  disabled={!detailsForm.accountHolder.trim() || !detailsForm.accountNumber.trim() || !detailsForm.bankName.trim() || savingDetails}
                  onClick={saveDetails} data-testid="button-save-bank"
                >
                  {savingDetails ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : "Save details"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* Monthly RedotPay request section */}
        {requestsEnabled ? <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Monthly RedotPay request</p>
            <span className="text-xs text-muted-foreground font-mono">Period {period}</span>
          </div>

          {!hasDetails ? (
            <p className="text-xs text-muted-foreground">Add bank details above to enable monthly requests.</p>
          ) : alreadyRequested ? (
            <div className="rounded-md bg-muted/20 border border-border/30 px-3 py-2 text-xs text-muted-foreground">
              A manual payout request already exists for {period}. One request per period is allowed.
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="space-y-1.5">
                <Label htmlFor="redot-currency">Currency</Label>
                <select
                  id="redot-currency" value={reqCurrency} onChange={(e) => setReqCurrency(e.target.value)}
                  data-testid="select-redot-currency"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {["usd", "eur", "mad", "gbp"].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                </select>
              </div>
              <p className="text-xs text-muted-foreground">
                The payout amount is calculated server-side from your confirmed/simulated 70% ledger
                allocations minus any already-committed requests.
              </p>
              {reqError && (
                <div className="flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                  <p className="text-xs text-destructive">{reqError}</p>
                </div>
              )}
              <Button
                className="w-full" disabled={submittingReq} onClick={submitManualPayout}
                data-testid="button-submit-redot"
              >
                {submittingReq
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</>
                  : <><Send className="w-4 h-4 mr-2" />Submit monthly request</>}
              </Button>
            </div>
          )}

          {/* Request history */}
          {requests.length > 0 && (
            <div className="space-y-1.5 mt-2">
              <p className="text-xs text-muted-foreground uppercase tracking-widest">Request history</p>
              {requests.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-md border border-border/30 bg-card/30 px-3 py-2 text-xs"
                  data-testid={`row-redot-${r.id}`}
                >
                  <div>
                    <p className="font-medium text-foreground">{fmtMinor(r.amountMinor, r.currency)}</p>
                    <p className="text-muted-foreground/70">Period {r.period} · {r.maskedAccount ?? "—"}</p>
                  </div>
                  <Badge variant={statusVariant[r.status]} data-testid={`badge-redot-status-${r.id}`}>
                    {r.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {manualState.status === "loading" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading requests...
            </div>
          )}
        </div> : <p className="text-xs text-muted-foreground">RedotPay payout requests are unavailable in simulation mode. Test allocations never become payout obligations.</p>}
      </CardContent>
    </Card>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function FinanceOnboarding() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { isOnline } = useConnectivity();
  const { toast } = useToast();
  const { state: walletState, refetch: refetchWallet } = useWalletData();
  const {simulation:SIMULATION_MODE}=useFinanceMode();

  const [step, setStep] = useState<Step>("owner-type");
  const [form, setForm] = useState<FormState>({
    ownerType: "", displayName: "", legalName: "", country: "MA", termsAccepted: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [beneficiary, setBeneficiary] = useState<Beneficiary | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => { if (user) refetchWallet(); }, [user, refetchWallet]);

  const existingBeneficiaries =
    walletState.status === "success" ? (walletState.data.beneficiaries ?? []) : [];
  const hasExisting = existingBeneficiaries.length > 0;

  if (!user) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4">
        <Card className="max-w-sm w-full">
          <CardContent className="p-8 text-center space-y-4">
            <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto" />
            <p className="font-semibold">Sign in required</p>
            <p className="text-sm text-muted-foreground">You must be signed in to set up a payout account.</p>
            <Button className="w-full" onClick={() => setLocation("/login")} data-testid="button-login-onboarding">Log in</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Refresh handler ──────────────────────────────────────────────────────────
  async function handleRefresh(b: Beneficiary) {
    setError("");
    setIsRefreshing(true);
    try {
      const result = await postRefresh(b.id);
      if (result.simulated) {
        await refetchWallet();
        toast({
          title: "Connect simulation refreshed",
          description: "No Stripe account or real-money payout was created.",
        });
      } else if (result.url) {
        window.location.href = result.url;
      } else {
        await refetchWallet();
        toast({ title: "Account up to date", description: "Payouts are already enabled for this account." });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to get refresh link");
    } finally {
      setIsRefreshing(false);
    }
  }

  // ── Step handlers ────────────────────────────────────────────────────────────
  async function handleAcceptTerms() {
    if (!isOnline) return;
    setError("");
    setSubmitting(true);
    try {
      const result = await postAcceptTerms({
        ownerType: form.ownerType,
        displayName: form.displayName,
        legalName: form.legalName,
        country: form.country,
        accepted: true,
      });
      setBeneficiary(result.beneficiary);
      setStep("stripe");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Redirect only when live mode returns a real Stripe-hosted URL.
  async function handleOpenStripe() {
    if (!isOnline || !beneficiary) return;
    setError("");
    setSubmitting(true);
    try {
      const result = await postOnboarding(beneficiary.id);
      if (result.simulated) {
        toast({
          title: "Stripe Connect simulated",
          description: result.message ?? "No Stripe account or real money was created.",
        });
        setStep("complete");
      } else {
        window.location.href = result.url;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start Stripe onboarding.");
    } finally {
      setSubmitting(false);
    }
  }

  // Mock Connect: calls the real onboarding endpoint and, if FINANCE_SIMULATION_MODE
  // is on, the server returns a Stripe test-mode link. For in-app testing we skip
  // the redirect and mark Connect as locally complete so testers can exercise the
  // simulation and payout-rails panels.
  async function handleMockConnect() {
    if (!isOnline || !beneficiary) return;
    setError("");
    setSubmitting(true);
    try {
      const result = await postOnboarding(beneficiary.id);
      if (!result.simulated) {
        throw new Error("The server is not in finance simulation mode.");
      }
      toast({
        title: "Stripe Connect simulated",
        description: result.message ?? "No Stripe account or real money was created.",
      });
      setStep("complete");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to simulate Stripe Connect.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Sub-step components ───────────────────────────────────────────────────────
  function StepOwnerType() {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Account type</h2>
          <p className="text-sm text-muted-foreground mt-1">Select the type of account you are registering.</p>
        </div>
        <div className="grid gap-3">
          {OWNER_TYPES.map(({ value, label, description, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setForm((f) => ({ ...f, ownerType: value }))}
              data-testid={`button-owner-type-${value}`}
              className={`flex items-center gap-4 p-4 rounded-lg border text-left transition-colors ${
                form.ownerType === value ? "border-primary bg-primary/5" : "border-border/40 bg-card/30 hover:border-border"
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${
                form.ownerType === value ? "border-primary/40 bg-primary/10" : "border-border/30 bg-muted/20"
              }`}>
                <Icon className={`w-5 h-5 ${form.ownerType === value ? "text-primary" : "text-muted-foreground"}`} />
              </div>
              <div>
                <p className="font-medium text-sm">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              {form.ownerType === value && <CheckCircle2 className="w-5 h-5 text-primary ml-auto shrink-0" />}
            </button>
          ))}
        </div>
        <Button className="w-full" disabled={!form.ownerType} onClick={() => setStep("details")} data-testid="button-next-owner-type">
          Continue <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    );
  }

  function StepDetails() {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Legal details</h2>
          <p className="text-sm text-muted-foreground mt-1">Enter your legal name and country. This will be verified by Stripe.</p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="displayName">Display name</Label>
            <Input id="displayName" value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              placeholder="How you appear to others" data-testid="input-display-name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="legalName">Legal name</Label>
            <Input id="legalName" value={form.legalName}
              onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))}
              placeholder="As it appears on your ID or business registration" data-testid="input-legal-name" />
            <p className="text-xs text-muted-foreground">Used for Stripe identity verification. Not shown publicly.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="country">Country</Label>
            <select
              id="country" value={form.country}
              onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
              data-testid="select-country"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setStep("owner-type")} data-testid="button-back-details">
            <ChevronLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <Button
            className="flex-1"
            disabled={!form.displayName.trim() || !form.legalName.trim() || !form.country}
            onClick={() => setStep("terms")}
            data-testid="button-next-details"
          >
            Continue <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    );
  }

  function StepTerms() {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Review and accept terms</h2>
          <p className="text-sm text-muted-foreground mt-1">Read the net-settlement terms carefully. You must accept them to continue.</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-muted/10 p-4 max-h-72 overflow-y-auto">
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
            {NET_SETTLEMENT_TERMS}
          </pre>
        </div>
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <input
                type="checkbox" id="acceptTerms" checked={form.termsAccepted}
                onChange={(e) => setForm((f) => ({ ...f, termsAccepted: e.target.checked }))}
                data-testid="checkbox-accept-terms"
                className="w-4 h-4 rounded accent-primary cursor-pointer"
              />
            </div>
            <label htmlFor="acceptTerms" className="text-sm cursor-pointer">
              <span className="font-medium text-foreground">I accept these terms</span>
              <span className="text-muted-foreground">
                {" "}— I confirm I have read and understood the net-settlement terms above ({CURRENT_TERMS_VERSION}), including the 70/30 revenue split and Test / Simulation Mode clause.
              </span>
            </label>
          </div>
        </div>
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setStep("details")} disabled={submitting} data-testid="button-back-terms">
            <ChevronLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <Button
            className="flex-1"
            disabled={!form.termsAccepted || submitting || !isOnline}
            onClick={handleAcceptTerms}
            data-testid="button-accept-and-continue"
          >
            {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
              : !isOnline ? <><WifiOff className="w-4 h-4 mr-2" />Offline</>
              : <>Accept and continue <ChevronRight className="w-4 h-4 ml-1" /></>}
          </Button>
        </div>
      </div>
    );
  }

  function StepStripe() {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Stripe Connect onboarding</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Connect a Stripe Express account to enable the 70% settlement flow.
          </p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/30 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="w-4 h-4 text-green-500 shrink-0" />
            Bank and card details are collected securely by Stripe — not stored on this platform.
          </div>
          <Separator />
          <div className="grid gap-1.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /><span>Terms accepted ({CURRENT_TERMS_VERSION})</span></div>
            <div className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /><span>Account type: <span className="font-medium capitalize">{form.ownerType}</span></span></div>
            <div className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /><span>Display name: <span className="font-medium">{form.displayName}</span></span></div>
          </div>
        </div>
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
        <Button
          className="w-full" disabled={submitting || !isOnline || !beneficiary}
          onClick={handleOpenStripe} data-testid="button-open-stripe"
        >
          {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Opening Stripe...</>
            : !isOnline ? <><WifiOff className="w-4 h-4 mr-2" />Offline</>
            : <>Open Stripe onboarding <ExternalLink className="w-4 h-4 ml-2" /></>}
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          You will be redirected to Stripe (test mode). Return here after completing their flow.
        </p>

        {SIMULATION_MODE && (
          <>
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground uppercase tracking-widest">or</span>
              <Separator className="flex-1" />
            </div>
            <Button
              variant="outline" className="w-full"
              onClick={handleMockConnect}
              disabled={submitting || !isOnline || !beneficiary}
              data-testid="button-mock-connect"
            >
              <FlaskConical className="w-4 h-4 mr-2" />
              Skip redirect — test simulation panels only
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Calls the real onboarding endpoint then bypasses the Stripe redirect so you can
              exercise the 70/30 simulation and payout-rails panels without leaving the app.
            </p>
          </>
        )}
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[calc(100dvh-4rem)] max-w-2xl mx-auto px-4 py-6 md:py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Payout Account Setup</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set up your beneficiary account and verify the settlement flow. This beta runs in
          Test / Simulation Mode — no real money is moved.
        </p>
      </div>

      {SIMULATION_MODE && (
        <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3" data-testid="banner-simulation-mode">
          <FlaskConical className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-foreground">Test / Simulation Mode</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connect onboarding and ledger payments are simulated in-page. Test allocations never become
              Stripe or RedotPay payout obligations.
            </p>
          </div>
        </div>
      )}

      {!isOnline && (
        <div className="flex items-center gap-2 rounded-lg bg-orange-500/10 border border-orange-500/30 px-4 py-2.5 text-sm text-orange-400">
          <WifiOff className="w-4 h-4 shrink-0" />
          You are offline. Mutations are disabled until connection is restored.
        </div>
      )}

      {/* Existing beneficiary — resume flow */}
      {hasExisting && step === "owner-type" && (
        <div className="space-y-4">
          <div className="rounded-lg bg-orange-500/10 border border-orange-500/30 px-4 py-3 text-sm text-orange-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            You already have a payout account. Resume setup or review its status below.
          </div>
          {existingBeneficiaries.map((b) => (
            <div key={b.id} className="space-y-4">
              <ExistingBeneficiaryPanel b={b} onRefresh={() => handleRefresh(b)} isRefreshing={isRefreshing} />
              {(b.ownerType === "event" || b.ownerType === "company") && (
                <PayoutRailsPanel beneficiary={b} requestsEnabled={!SIMULATION_MODE} />
              )}
            </div>
          ))}
          {SIMULATION_MODE && <SplitSimulationPanel beneficiary={existingBeneficiaries[0] ?? null} />}
          <Separator />
          <p className="text-xs text-muted-foreground text-center">
            Need to register a different account type? Continue below.
          </p>
          <Button variant="outline" className="w-full" onClick={() => setStep("owner-type")} data-testid="button-new-account-type">
            Register a new account
          </Button>
        </div>
      )}

      {/* Step-based flow */}
      {(!hasExisting || step !== "owner-type") && (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-6 space-y-6">
            <StepIndicator current={step} />
            <Separator />
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2 }}
              >
                {step === "owner-type" && <StepOwnerType />}
                {step === "details"    && <StepDetails />}
                {step === "terms"      && <StepTerms />}
                {step === "stripe"     && <StepStripe />}
                {step === "complete"   && (
                  <div className="space-y-6 py-2">
                    <div className="text-center space-y-3">
                      <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto" />
                      <h2 className="text-lg font-semibold">Setup complete</h2>
                      <p className="text-sm text-muted-foreground">
                        Your account is registered. In Test / Simulation Mode, use the panels below
                       to exercise the 70/30 split logic — no real money moves.
                      </p>
                    </div>
                    {SIMULATION_MODE && <SplitSimulationPanel beneficiary={beneficiary} />}
                    {beneficiary && (beneficiary.ownerType === "event" || beneficiary.ownerType === "company") && (
                       <PayoutRailsPanel beneficiary={beneficiary} requestsEnabled={!SIMULATION_MODE} />
                    )}
                    <Button className="w-full" onClick={() => setLocation("/wallet")} data-testid="button-go-to-wallet">
                      Go to wallet
                    </Button>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
