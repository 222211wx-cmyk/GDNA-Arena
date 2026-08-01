/**
 * COINS DISCLAIMER BANNER
 * Persistent slim bar — shown for countries where coinsDisclaimer = true.
 * Not a popup — user can dismiss it per session (sessionStorage).
 */
import { useState } from "react";
import { X } from "lucide-react";
import { useLegal } from "@/contexts/LegalContext";
import { useLang } from "@/contexts/LangContext";

const TEXT = {
  en: "⚠️ GDNA Arena coins are virtual credits with no real-world monetary value. Not exchangeable for cash or crypto.",
  ar: "⚠️ كوينز GDNA Arena رصيد افتراضي فقط، ليس له قيمة نقدية حقيقية ولا يمكن استبداله بمال أو عملات رقمية.",
  fr: "⚠️ Les coins GDNA Arena sont des crédits virtuels sans valeur monétaire réelle — non échangeables.",
  es: "⚠️ Las monedas GDNA Arena son créditos virtuales sin valor monetario real — no canjeables.",
  de: "⚠️ GDNA Arena Coins sind virtuelle Guthaben ohne realen Geldwert — nicht einlösbar.",
};

export default function CoinsDisclaimer() {
  const { country } = useLegal();
  const { lang }    = useLang();
  const isRTL       = lang === "ar";

  const [dismissed, setDismissed] = useState(() =>
    sessionStorage.getItem("gdna_coins_banner") === "1"
  );

  if (!country.coinsDisclaimer || dismissed) return null;

  const dismiss = () => {
    sessionStorage.setItem("gdna_coins_banner", "1");
    setDismissed(true);
  };

  const text = TEXT[lang as keyof typeof TEXT] ?? TEXT.en;

  return (
    <div
      dir={isRTL ? "rtl" : "ltr"}
      className="w-full bg-orange-950/70 border-b border-orange-500/30 px-4 py-2 flex items-center gap-3 z-40"
    >
      <p className="flex-1 text-orange-300 text-xs leading-relaxed">{text}</p>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 text-orange-400/60 hover:text-orange-300 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}
