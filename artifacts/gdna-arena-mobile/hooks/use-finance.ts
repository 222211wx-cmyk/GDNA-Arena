/**
 * Finance domain hooks.
 *
 * Key facts from the backend:
 * - CURRENT_TERMS_VERSION = "finance-terms-2025-01" (server-authoritative — fetched via GET /finance/wallet)
 * - Finance mode is server-authoritative; clients fail closed while config is unavailable.
 *   POST /finance/payouts returns 409 in simulation — UI must never show it as a valid payout action.
 * - Real simulation flow: POST /finance/simulation/payments, POST /finance/simulation/refunds.
 * - Manual payout: PUT /finance/beneficiaries/:id/payout-details → POST /finance/manual-payouts.
 * - POST /finance/connect/refresh returns { beneficiary, url, simulated }.
 * - GET /finance/wallet returns { coinBalance, fiat, entries, beneficiary, beneficiaries, wallets }.
 * - POST /finance/beneficiaries/accept-terms needs { accepted: true, ownerType|entityType, displayName|legalName, country (2-letter ISO), termsVersion }.
 * - All mutations block when offline (assertNetworkOnline is called inside api helpers).
 * - No optimistic financial state updates.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiRequest } from '@/lib/api';

// ─── Response types ────────────────────────────────────────────────────────────

export interface WalletFiat {
  available: number;
  pending: number;
  reserved: number;
  paid: number;
  income: number;
  expense: number;
  currency: string;
}

export interface WalletEntry {
  id: string;
  type: string;
  amountMinor: number;
  currency: string;
  description: string;
  createdAt: string;
  immutable: boolean;
}

export type BeneficiaryStatus =
  | 'none'
  | 'pending'
  | 'onboarding'
  | 'restricted'
  | 'requirements_due'
  | 'enabled'
  | 'disabled';

export interface Beneficiary {
  id: string;
  status: BeneficiaryStatus;
  ownerType: string;
  displayName: string | null;
  /** True iff the server-current terms version matches the accepted version */
  termsAccepted: boolean;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  stripeAccountId: string | null;
  country: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  canPayout: boolean;
  /** Morocco: false until Stripe + Bank Al-Maghrib confirmed */
  eligibilityConfirmed: boolean;
  requirementsDue: string[];
  requirements: string[];
  restrictionReason: string | null;
}

export interface WalletData {
  coinBalance: number;
  coins: { balance: number };
  fiat: WalletFiat;
  entries: WalletEntry[];
  /** The primary beneficiary for this user (may be { status: 'none' } if not set up) */
  beneficiary: Beneficiary | { status: 'none' };
  beneficiaries: Beneficiary[];
  wallets: Array<{ id: string; asset: string; currency: string; availableMinor: number }>;
}

export interface AcceptTermsBody {
  /** Matches backend: ownerType (server also accepts entityType) */
  ownerType: 'citizen' | 'event' | 'company';
  displayName: string;
  /** Exactly 2-letter ISO 3166-1 alpha-2 */
  country: string;
  /** Must equal CURRENT_TERMS_VERSION from server */
  termsVersion: string;
  accepted: true;
}

export interface AcceptTermsResult {
  beneficiary: Beneficiary;
}

export interface OnboardingBody {
  beneficiaryId?: string;
}

export interface OnboardingResult {
  url: string;
  simulated?: boolean;
  message?: string;
}

export interface RefreshResult {
  beneficiary: Beneficiary;
  url: string | null;
  simulated?: boolean;
}

export interface SimulationPaymentBody {
  beneficiaryId: string;
  amountMinor: number;
  currency: string;
  description: string;
  idempotencyKey: string;
}

export interface SimulationPaymentResult {
  payment: {
    id: string;
    amountMinor: number;
    currency: string;
    status: string;
    simulated: true;
    journalId?: string;
    beneficiaryMinor?: number;
    platformMinor?: number;
    duplicate?: boolean;
  };
}

export interface SimulationRefundBody {
  journalId: string;
  idempotencyKey: string;
}

export interface SimulationRefundResult {
  refund: {
    journalId: string;
    reversalOf: string;
    duplicate: boolean;
    simulated: true;
  };
}

export interface PayoutDetailsBody {
  accountHolder: string;
  bankName: string;
  accountNumber: string;
  routingCode?: string;
}

export interface PayoutDetailsResult {
  payoutDetails: {
    id: string;
    beneficiaryId: string;
    maskedAccount: string;
  };
}

export interface ManualPayoutBody {
  beneficiaryId: string;
  period: string; // "YYYY-MM"
  currency: string;
}

export interface ManualPayout {
  id: string;
  beneficiaryId: string;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  provider: string;
  amountMinor: number;
  currency: string;
  period: string;
  maskedAccount?: string;
  automated: false;
  createdAt?: string;
}

export interface ManualPayoutResult {
  payout: ManualPayout;
}

export interface ManualPayoutsListResult {
  payouts: ManualPayout[];
}

export interface Invoice {
  id: string;
  reference: string;
  amountMinor: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  createdAt: string;
  pdfUrl: string | null;
  description: string;
}

export interface InvoiceList {
  invoices: Invoice[];
  total: number;
}

export interface FinanceTerms {
  /** Server-authoritative current terms version, e.g. "finance-terms-2025-01". */
  currentVersion: string;
  termsVersion:string;
  simulation:boolean;
  moneyMovementEnabled:boolean;
  operatingMode:'simulation'|'live';
  /** Human-readable label for display, if provided by server. */
  label?: string;
  /** ISO date when this version became effective, if provided. */
  effectiveAt?: string;
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const financeKeys = {
  wallet: (userId: number) => ['finance', 'wallet', userId] as const,
  invoices: (userId: number) => ['finance', 'invoices', userId] as const,
  manualPayouts: (userId: number) => ['finance', 'manual-payouts', userId] as const,
  /** Not user-scoped: the current terms version is global. */
  terms: ['finance', 'terms'] as const,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Type guard: checks if a beneficiary value is a real Beneficiary (not the stub { status: 'none' }). */
export function isRealBeneficiary(b: Beneficiary | { status: 'none' } | undefined): b is Beneficiary {
  return !!b && 'id' in b;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useWallet(userId: number | undefined) {
  return useQuery({
    queryKey: financeKeys.wallet(userId ?? 0),
    queryFn: () => apiGet<WalletData>('/finance/wallet'),
    enabled: !!userId,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useInvoices(userId: number | undefined) {
  return useQuery({
    queryKey: financeKeys.invoices(userId ?? 0),
    queryFn: () => apiGet<InvoiceList>('/finance/invoices'),
    enabled: !!userId,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useManualPayouts(userId: number | undefined) {
  return useQuery({
    queryKey: financeKeys.manualPayouts(userId ?? 0),
    queryFn: () => apiGet<ManualPayoutsListResult>('/finance/manual-payouts'),
    enabled: !!userId,
    staleTime: 30_000,
    retry: 1,
  });
}

/**
 * Fetches the server-authoritative current terms version from GET /finance/terms.
 * Not user-scoped — the endpoint is public/unauthenticated or authenticated-read.
 * Returns null while loading or on error; callers must disable acceptance until
 * a non-null version is available.
 */
export function useFinanceTerms() {
  return useQuery({
    queryKey: financeKeys.terms,
    queryFn: () => apiGet<FinanceTerms>('/finance/terms'),
    staleTime: 5 * 60_000, // terms version changes rarely; 5-min cache is fine
    retry: 2,
    // Do not retry on 404 — backend may not have deployed yet
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useAcceptTerms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AcceptTermsBody) =>
      apiPost<AcceptTermsResult>('/finance/beneficiaries/accept-terms', body),
    onSuccess: (_data, _vars, _ctx) => {
      void queryClient.invalidateQueries({ queryKey: ['finance'] });
    },
  });
}

export function useStartOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OnboardingBody) =>
      apiPost<OnboardingResult>('/finance/connect/onboarding', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finance'] });
    },
  });
}

export function useRefreshOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body?: { beneficiaryId?: string }) =>
      apiPost<RefreshResult>('/finance/connect/refresh', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finance'] });
    },
  });
}

export function useSimulatePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SimulationPaymentBody) =>
      apiPost<SimulationPaymentResult>('/finance/simulation/payments', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finance'] });
    },
  });
}

export function useSimulateRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SimulationRefundBody) =>
      apiPost<SimulationRefundResult>('/finance/simulation/refunds', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finance'] });
    },
  });
}

export function useSavePayoutDetails(beneficiaryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PayoutDetailsBody) =>
      apiRequest<PayoutDetailsResult, PayoutDetailsBody>(
        'PUT',
        `/finance/beneficiaries/${encodeURIComponent(beneficiaryId)}/payout-details`,
        body,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finance'] });
    },
  });
}

export function useRequestManualPayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ManualPayoutBody) =>
      apiPost<ManualPayoutResult>('/finance/manual-payouts', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finance'] });
    },
  });
}
