/**
 * RoyalReserveCredit — compact Royal Reserve call-credit panel for the Calls
 * destination inside the shared Messenger. OWNED by the credit feature.
 *
 * Shows paid + reserve minutes, reserve expiry countdown (48h), and outstanding
 * debt. Activation requires knowing consent (checkbox) to a SIMULATED 15 MAD
 * debt for 120 min / 48h and is disabled when the server says canActivate is
 * false, when offline, or while a request is in flight. Never activates
 * silently. Sandbox repayment is shown only in DEV with a clear no-real-funds
 * disclosure. All mutation loading/error/duplicate states are handled.
 *
 * Composed from design-system primitives + tokens only. No emojis.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Coins, Clock, TriangleAlert, ShieldCheck, LoaderCircle } from "lucide-react";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Badge } from "@workspace/gdna-ds/components/ui/badge";
import { Checkbox } from "@workspace/gdna-ds/components/ui/checkbox";
import { Separator } from "@workspace/gdna-ds/components/ui/separator";
import { Skeleton } from "@workspace/gdna-ds/components/ui/skeleton";
import { MAX_REPAYMENT_MINOR, type ReserveCredit, type ReservePolicy } from "@/hooks/use-royal-reserve";
import type { ReserveCopy } from "@/i18n/royal-reserve-copy";

function formatMinor(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

// 48h reserve expiry countdown. Recomputes each second while a reserve is live.
function useCountdown(expiresAt: string | null): {
  expired: boolean;
  label: string | null;
} {
  const [now, setNow] = useState(() => Date.now());
  const targetRef = useRef<number | null>(null);
  targetRef.current = expiresAt ? new Date(expiresAt).getTime() : null;

  useEffect(() => {
    if (!expiresAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  return useMemo(() => {
    const target = targetRef.current;
    if (target == null || Number.isNaN(target)) return { expired: false, label: null };
    const diff = target - now;
    if (diff <= 0) return { expired: true, label: null };
    const totalSec = Math.floor(diff / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const two = (n: number) => String(n).padStart(2, "0");
    return { expired: false, label: `${two(h)}:${two(m)}:${two(s)}` };
  }, [now]);
}

export function RoyalReserveCredit({
  rt,
  lang,
  credit,
  policy,
  isLoading,
  isError,
  onRetry,
  canActivate,
  onActivate,
  reserveIsPending,
  reserveIsError,
  online,
  showSandboxRepay,
  onRepay,
  repayIsPending,
  repayIsError,
  repayErrorNotAvailable,
}: {
  rt: ReserveCopy;
  lang: string;
  credit: ReserveCredit | null;
  policy: ReservePolicy | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  canActivate: boolean;
  onActivate: () => void;
  reserveIsPending: boolean;
  reserveIsError: boolean;
  online: boolean;
  showSandboxRepay: boolean;
  onRepay: (amountMinor: number) => void;
  repayIsPending: boolean;
  repayIsError: boolean;
  repayErrorNotAvailable: boolean;
}) {
  const [consent, setConsent] = useState(false);
  const countdown = useCountdown(credit?.reserveExpiresAt ?? null);
  const hasDebt = (credit?.debtMinor ?? 0) > 0;
  // Never present or send more than the backend's 1000 MAD sandbox cap.
  const repayAmountMinor = Math.min(credit?.debtMinor ?? 0, MAX_REPAYMENT_MINOR);
  const packageCost = policy ? formatMinor(policy.packageCostMinor, credit?.currency ?? rt.currency_mad) : null;

  const activationDisabled =
    !online || !canActivate || !consent || reserveIsPending;

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-3" data-testid="reserve-loading">
        <div className="mb-3 flex items-center gap-2">
          <Coins className="h-4 w-4 shrink-0 text-primary" />
          <p className="m-0 text-sm font-bold text-card-foreground">{rt.credit_title}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
        <Skeleton className="mt-2 h-9 w-full rounded-md" />
      </div>
    );
  }

  if (isError || !credit) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3" data-testid="reserve-error">
        <div className="flex items-center gap-2">
          <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
          <p className="m-0 flex-1 text-sm font-semibold text-destructive">{rt.credit_load_failed}</p>
          <Button size="sm" variant="outline" onClick={onRetry} disabled={!online} data-testid="button-reserve-retry">
            {rt.retry}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-border bg-card p-3"
      dir={lang === "ar" ? "rtl" : "ltr"}
      data-testid="reserve-panel"
    >
      {/* Header + reserve identity badge */}
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-sm font-bold text-card-foreground">{rt.credit_title}</p>
          <p className="m-0 truncate text-xs text-muted-foreground">{rt.credit_subtitle}</p>
        </div>
        <Badge variant="outline" className="shrink-0">{rt.reserve_identity}</Badge>
      </div>

      {/* Balance grid: paid + reserve minutes */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border bg-background p-2.5">
          <p className="m-0 text-xs text-muted-foreground">{rt.paid_minutes}</p>
          <p className="m-0 mt-0.5 text-lg font-black text-foreground" data-testid="text-paid-minutes">
            {credit.balanceMinutes}
            <span className="ms-1 text-xs font-medium text-muted-foreground">{rt.minutes_unit}</span>
          </p>
        </div>
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5">
          <p className="m-0 text-xs text-muted-foreground">{rt.reserve_minutes}</p>
          <p className="m-0 mt-0.5 text-lg font-black text-primary" data-testid="text-reserve-minutes">
            {credit.reserveMinutes}
            <span className="ms-1 text-xs font-medium text-muted-foreground">{rt.minutes_unit}</span>
          </p>
        </div>
      </div>

      {/* Reserve expiry countdown */}
      <div className="mt-2 flex items-center gap-2 text-xs">
        <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {credit.reserveMinutes > 0 && credit.reserveExpiresAt && !countdown.expired ? (
          <span className="text-muted-foreground">
            {rt.expires_in}{" "}
            <span className="font-mono font-semibold text-foreground" data-testid="text-reserve-countdown">
              {countdown.label}
            </span>
          </span>
        ) : credit.reserveExpiresAt && countdown.expired ? (
          <span className="font-semibold text-destructive">{rt.expired}</span>
        ) : (
          <span className="text-muted-foreground">{rt.no_reserve}</span>
        )}
      </div>

      {/* Outstanding debt */}
      <div className="mt-2 flex items-center gap-2 text-xs" data-testid="reserve-debt">
        <Coins className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {hasDebt ? (
          <span className="font-semibold text-destructive">
            {rt.debt_label}: {formatMinor(credit.debtMinor, credit.currency)}
          </span>
        ) : (
          <span className="text-muted-foreground">{rt.no_debt}</span>
        )}
      </div>
      {hasDebt && (
        <p className="m-0 mt-1 text-xs leading-relaxed text-muted-foreground">{rt.debt_first_note}</p>
      )}

      <Separator className="my-3" />

      {/* Activation with knowing consent */}
      {credit.canActivate ? (
        <div>
          <p className="m-0 text-xs leading-relaxed text-muted-foreground" data-testid="text-activate-help">
            {rt.activate_help}
          </p>
          <label className="mt-2 flex cursor-pointer items-start gap-2">
            <Checkbox
              checked={consent}
              onCheckedChange={(v) => setConsent(v === true)}
              disabled={reserveIsPending || !online}
              className="mt-0.5"
              data-testid="checkbox-reserve-consent"
            />
            <span className="text-xs leading-relaxed text-foreground">{rt.activate_consent}</span>
          </label>
          <Button
            className="mt-2.5 w-full gap-2"
            disabled={activationDisabled}
            onClick={onActivate}
            data-testid="button-activate-reserve"
          >
            {reserveIsPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            {reserveIsPending ? rt.activating : rt.activate}
            {packageCost && !reserveIsPending && (
              <span className="text-xs font-normal opacity-80">· {packageCost}</span>
            )}
          </Button>
          <p className="m-0 mt-1.5 text-center text-xs text-muted-foreground">{rt.simulated_note}</p>
          {reserveIsError && (
            <p className="m-0 mt-1.5 text-center text-xs font-semibold text-destructive" data-testid="text-reserve-error">
              {rt.activation_failed}
            </p>
          )}
        </div>
      ) : (
        <p className="m-0 text-xs text-muted-foreground" data-testid="text-cannot-activate">{rt.cannot_activate}</p>
      )}

      {/* DEV-only sandbox repayment — clearly no real funds */}
      {showSandboxRepay && hasDebt && (
        <>
          <Separator className="my-3" />
          <div data-testid="reserve-sandbox-repay">
            <div className="flex items-center gap-2">
              <p className="m-0 flex-1 text-xs font-bold text-card-foreground">{rt.repay_title}</p>
              <Badge variant="secondary">DEV</Badge>
            </div>
            <p className="m-0 mt-1 text-xs leading-relaxed text-muted-foreground">{rt.repay_sandbox_note}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 w-full gap-2"
              disabled={repayIsPending || !online}
              onClick={() => onRepay(repayAmountMinor)}
              data-testid="button-sandbox-repay"
            >
              {repayIsPending && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
              {repayIsPending ? rt.repaying : `${rt.repay} · ${formatMinor(repayAmountMinor, credit.currency)}`}
            </Button>
            {repayIsError && (
              <p className="m-0 mt-1.5 text-center text-xs font-semibold text-destructive">
                {repayErrorNotAvailable ? rt.cannot_activate : rt.repay_failed}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
