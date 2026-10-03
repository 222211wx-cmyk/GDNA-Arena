import { useEffect } from "react";
import { useLocation } from "wouter";
import { ArrowRight } from "lucide-react";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { useLang } from "@/contexts/LangContext";
import { closeBackLayer, navigationDepth, trackAppHistory } from "@/lib/back-navigation";

export function BackButton() {
  const [, navigate] = useLocation();
  const { lang } = useLang();
  useEffect(trackAppHistory, []);
  const label = ({ ar: "رجوع", en: "Back", fr: "Retour", es: "Volver", de: "Zurück" } as Record<string, string>)[lang] ?? "Back";
  return (
    <div className="fixed right-4 top-4 z-50">
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-10 w-10 rounded-full bg-background text-foreground shadow-sm"
      aria-label={label}
      title={label}
      onClick={() => {
        if (closeBackLayer()) return;
        if (navigationDepth() > 0) history.back();
        else navigate("/", { replace: true });
      }}
    >
      <ArrowRight className="h-5 w-5" aria-hidden="true" />
    </Button>
    </div>
  );
}