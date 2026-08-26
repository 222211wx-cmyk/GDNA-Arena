import { Alert, AlertDescription } from "@workspace/gdna-ds/components/ui/alert";

export function BetaSimulationBanner() {
  return (
    <Alert
      className="rounded-none border-x-0 border-t-0 border-primary/30 bg-primary/10 py-2 text-primary"
      data-testid="banner-public-beta"
    >
      <AlertDescription className="text-center text-xs font-bold tracking-wide sm:text-sm" dir="rtl">
        هذا نسخة تجريبية. الدفع بـ Simulation
      </AlertDescription>
    </Alert>
  );
}