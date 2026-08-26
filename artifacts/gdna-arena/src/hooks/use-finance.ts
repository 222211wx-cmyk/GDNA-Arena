import { useState, useCallback, useEffect } from "react";
import { apiPath } from "@/lib/network";

// ── Constants aligned to backend (finance-ledger.ts) ────────────────────────────
export const CURRENT_TERMS_VERSION = "finance-terms-2025-01";
export const PLATFORM_BPS = 3000; // 30%
export const BENEFICIARY_BPS = 7000; // 70%

export interface FinanceTermsConfig {
  currentVersion:string; termsVersion:string; simulation:boolean;
  moneyMovementEnabled:boolean; operatingMode:"simulation"|"live";
}
/** Server-authoritative and fail-closed while loading or on error. */
export function useFinanceMode() {
  const [config,setConfig]=useState<FinanceTermsConfig|null>(null);
  const [error,setError]=useState(false);
  useEffect(()=>{let active=true;fetch(apiPath("/api/finance/terms"),{credentials:"include"})
    .then(async r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json() as Promise<FinanceTermsConfig>;})
    .then(value=>{if(active)setConfig(value);}).catch(()=>{if(active)setError(true);});
    return()=>{active=false;};},[]);
  const moneyMovementEnabled=config?.moneyMovementEnabled===true&&config.operatingMode==="live";
  return {config,loading:!config&&!error,error,simulation:!moneyMovementEnabled,moneyMovementEnabled};
}

// ── Type definitions ────────────────────────────────────────────────────────────

export interface LedgerEntry {
  id: string;
  type: string;
  amountMinor: number;
  currency: string;
  description: string;
  createdAt: string;
  immutable: boolean;
}

export interface FiatSummary {
  currency: string;
  available: number;
  pending: number;
  reserved: number;
  paid: number;
  income: number;
  expense: number;
}

export interface Beneficiary {
  id: string;
  status: string;
  ownerType: string;
  displayName: string;
  termsAccepted: boolean;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  stripeAccountId: string | null;
  country: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsDue: string[];
  canPayout: boolean;
  eligibilityConfirmed?: boolean;
  restrictionReason: string | null;
}

export interface WalletData {
  coinBalance: number;
  coins: { balance: number };
  fiat: FiatSummary;
  entries: LedgerEntry[];
  beneficiary: Beneficiary | { status: "none" };
  beneficiaries: Beneficiary[];
}

// ── Admin dashboard ─────────────────────────────────────────────────────────────
export interface AdminFiatRow {
  currency: string;
  available: string;
  reserved: string;
}

export interface AdminDashboard {
  fiat: AdminFiatRow[];
  openReconciliationIssues: number;
}

// ── Simulation payment ──────────────────────────────────────────────────────────
export interface SimulationPayment {
  id: string;
  amountMinor: number;
  currency: string;
  status: string;
  simulated: true;
  journalId?: string;
  beneficiaryMinor?: number;
  platformMinor?: number;
  duplicate?: boolean;
}

export interface SimulationRefund {
  journalId: string;
  reversalOf: string;
  duplicate: boolean;
  simulated: true;
}

// ── Payout details (PUT /api/finance/beneficiaries/:id/payout-details) ──────────
export interface PayoutDetails {
  id: string;
  beneficiaryId: string;
  maskedAccount: string;
}

// ── Manual payout request ───────────────────────────────────────────────────────
export interface ManualPayoutRequest {
  id: string;
  beneficiaryId: string;
  displayName?: string;
  status: "pending" | "approved" | "rejected" | "paid";
  provider: string;
  amountMinor: number;
  currency: string;
  period: string;
  maskedAccount?: string;
  automated: false;
  createdAt?: string;
}

// ── Fetch state ─────────────────────────────────────────────────────────────────
export type FetchState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: string };

async function readError(res: Response): Promise<string> {
  const j = await res.json().catch(() => ({}));
  return (j as { error?: string }).error ?? `HTTP ${res.status}`;
}

// ── Hooks ───────────────────────────────────────────────────────────────────────
export function useWalletData() {
  const [state, setState] = useState<FetchState<WalletData>>({ status: "idle" });

  const refetch = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(apiPath("/api/finance/wallet"), { credentials: "include" });
      if (!res.ok) { setState({ status: "error", error: await readError(res) }); return; }
      setState({ status: "success", data: (await res.json()) as WalletData });
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : "Network error" });
    }
  }, []);

  return { state, refetch };
}

export function useAdminDashboard() {
  const [state, setState] = useState<FetchState<AdminDashboard>>({ status: "idle" });

  const refetch = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(apiPath("/api/finance/admin/dashboard"), { credentials: "include" });
      if (!res.ok) { setState({ status: "error", error: await readError(res) }); return; }
      setState({ status: "success", data: (await res.json()) as AdminDashboard });
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : "Network error" });
    }
  }, []);

  return { state, refetch };
}

export function useManualPayouts() {
  const [state, setState] = useState<FetchState<ManualPayoutRequest[]>>({ status: "idle" });

  const refetch = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(apiPath("/api/finance/manual-payouts"), { credentials: "include" });
      if (!res.ok) { setState({ status: "error", error: await readError(res) }); return; }
      const j = (await res.json()) as { payouts: ManualPayoutRequest[] };
      setState({ status: "success", data: j.payouts ?? [] });
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : "Network error" });
    }
  }, []);

  return { state, refetch };
}

export function useAdminManualPayouts() {
  const [state, setState] = useState<FetchState<ManualPayoutRequest[]>>({ status: "idle" });

  const refetch = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(apiPath("/api/finance/admin/manual-payouts"), { credentials: "include" });
      if (!res.ok) { setState({ status: "error", error: await readError(res) }); return; }
      const j = (await res.json()) as { payouts: ManualPayoutRequest[] };
      setState({ status: "success", data: j.payouts ?? [] });
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : "Network error" });
    }
  }, []);

  return { state, refetch };
}

// ── Mutations ───────────────────────────────────────────────────────────────────

export async function postAcceptTerms(body: {
  ownerType: string;
  displayName: string;
  legalName: string;
  country: string;
  accepted: true;
}): Promise<{ beneficiary: Beneficiary }> {
  const res = await fetch(apiPath("/api/finance/beneficiaries/accept-terms"), {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, termsVersion: CURRENT_TERMS_VERSION }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { beneficiary: Beneficiary };
}

export async function postOnboarding(beneficiaryId: string): Promise<{
  url: string;
  simulated: boolean;
  message?: string;
}> {
  const res = await fetch(apiPath("/api/finance/connect/onboarding"), {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ beneficiaryId }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const j = (await res.json()) as { url?: string; simulated?: boolean; message?: string };
  if (!j.url) throw new Error("No onboarding URL returned");
  return { url: j.url, simulated: j.simulated === true, message: j.message };
}

export async function postRefresh(beneficiaryId: string): Promise<{
  beneficiary?: Beneficiary;
  url: string | null;
  simulated?: boolean;
}> {
  const res = await fetch(apiPath("/api/finance/connect/refresh"), {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ beneficiaryId }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { beneficiary?: Beneficiary; url: string | null; simulated?: boolean };
}

/** POST /api/finance/simulation/payments — persisted server-side. */
export async function postSimulatePayment(body: {
  beneficiaryId: string;
  amountMinor: number;
  currency: string;
  description: string;
  idempotencyKey: string;
}): Promise<{ payment: SimulationPayment }> {
  const res = await fetch(apiPath("/api/finance/simulation/payments"), {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { payment: SimulationPayment };
}

/** POST /api/finance/simulation/refunds */
export async function postSimulateRefund(body: {
  journalId: string;
  idempotencyKey: string;
}): Promise<{ refund: SimulationRefund }> {
  const res = await fetch(apiPath("/api/finance/simulation/refunds"), {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { refund: SimulationRefund };
}

/** PUT /api/finance/beneficiaries/:id/payout-details — event/company only. */
export async function putPayoutDetails(
  beneficiaryId: string,
  body: { accountHolder: string; bankName: string; accountNumber: string; routingCode?: string },
): Promise<{ payoutDetails: PayoutDetails }> {
  const res = await fetch(apiPath(`/api/finance/beneficiaries/${beneficiaryId}/payout-details`), {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { payoutDetails: PayoutDetails };
}

/** POST /api/finance/manual-payouts — monthly manual RedotPay request. */
export async function postManualPayout(body: {
  beneficiaryId: string;
  period: string;
  currency: string;
}): Promise<{ payout: ManualPayoutRequest }> {
  const res = await fetch(apiPath("/api/finance/manual-payouts"), {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { payout: ManualPayoutRequest };
}

/** PATCH /api/finance/admin/manual-payouts/:id */
export async function patchAdminManualPayout(
  id: string,
  body: { status: "approved" | "rejected" | "paid"; note?: string },
): Promise<{ payout: ManualPayoutRequest }> {
  const res = await fetch(apiPath(`/api/finance/admin/manual-payouts/${id}`), {
    method: "PATCH", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { payout: ManualPayoutRequest };
}

/** POST /api/finance/admin/reconcile */
export async function postReconcile(): Promise<{ issuesCreated: number }> {
  const res = await fetch(apiPath("/api/finance/admin/reconcile"), {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { issuesCreated: number };
}

// ── 70/30 net split — mirrors backend splitNet7030 exactly ──────────────────────
export function splitNet7030(netMinor: number): { beneficiaryMinor: number; platformMinor: number } {
  if (!Number.isSafeInteger(netMinor) || netMinor < 0) return { beneficiaryMinor: 0, platformMinor: 0 };
  const platformMinor = Math.floor((netMinor * PLATFORM_BPS) / 10_000);
  return { beneficiaryMinor: netMinor - platformMinor, platformMinor };
}

// ── UI-only idempotency key generator (no persistence, just unique per action) ──
export function newIdempotencyKey(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${rand}`;
}
