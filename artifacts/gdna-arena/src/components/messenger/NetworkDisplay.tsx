/**
 * NetworkDisplay — compact, honest network status for the Calls destination.
 *
 * Shows the browser's ACTUAL connectivity. When the physical bearer is unknown
 * it says only "Network available" — it never fakes WiFi/4G. effectiveType is
 * labelled as a speed estimate. When offline it shows the exact reserve-safe
 * message and never claims a call can proceed.
 *
 * Composed entirely from design-system primitives + tokens (no new variants).
 */
import { Wifi, WifiOff } from "lucide-react";
import { Badge } from "@workspace/gdna-ds/components/ui/badge";
import { cn } from "@workspace/gdna-ds/lib/utils";
import type { NetworkStatus } from "@/hooks/use-network-status";
import type { ReserveCopy } from "@/i18n/royal-reserve-copy";

export function NetworkDisplay({
  status,
  rt,
  className,
}: {
  status: NetworkStatus;
  rt: ReserveCopy;
  className?: string;
}) {
  const { online, connectionType, effectiveType } = status;

  if (!online) {
    return (
      <div
        className={cn(
          "rounded-lg border border-destructive/40 bg-destructive/10 p-3",
          className,
        )}
        data-testid="network-offline"
      >
        <div className="flex items-center gap-2">
          <WifiOff className="h-4 w-4 shrink-0 text-destructive" />
          <p className="m-0 text-sm font-bold text-destructive">
            {rt.network_offline}
          </p>
        </div>
        <p className="m-0 mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {rt.network_offline_reserve}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn("rounded-lg border border-border bg-card p-3", className)}
      data-testid="network-online"
    >
      <div className="flex items-center gap-2">
        <Wifi className="h-4 w-4 shrink-0 text-primary" />
        <p className="m-0 flex-1 text-sm font-bold text-card-foreground">
          {rt.network_title}
        </p>
        <Badge variant="secondary" className="uppercase">
          {connectionType ?? rt.network_available}
        </Badge>
      </div>
      {effectiveType && (
        <p className="m-0 mt-2 text-xs text-muted-foreground">
          {rt.network_type}: {effectiveType.toUpperCase()}{" "}
          <span className="opacity-70">· {rt.network_estimate_note}</span>
        </p>
      )}
    </div>
  );
}
