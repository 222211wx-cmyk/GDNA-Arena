import { Alert, AlertDescription } from "@workspace/gdna-ds/components/ui/alert";
import { Wifi, WifiOff } from "lucide-react";
import { useConnectivity } from "@/contexts/ConnectivityContext";
import { useLang } from "@/contexts/LangContext";

const copy = {
  en: {
    offline: "You are offline. Actions that need the network are unavailable.",
    blocked: "Action blocked. Reconnect to make this change.",
    reconnecting: "Reconnecting to live updates…",
  },
  ar: {
    offline: "أنت غير متصل. الإجراءات التي تحتاج إلى الشبكة غير متاحة.",
    blocked: "تم منع الإجراء. أعد الاتصال لتنفيذ هذا التغيير.",
    reconnecting: "جارٍ إعادة الاتصال بالتحديثات المباشرة…",
  },
  fr: {
    offline: "Vous êtes hors ligne. Les actions nécessitant le réseau sont indisponibles.",
    blocked: "Action bloquée. Reconnectez-vous pour effectuer ce changement.",
    reconnecting: "Reconnexion aux mises à jour en direct…",
  },
  es: {
    offline: "No tienes conexión. Las acciones que requieren red no están disponibles.",
    blocked: "Acción bloqueada. Vuelve a conectarte para realizar este cambio.",
    reconnecting: "Reconectando a las actualizaciones en directo…",
  },
  de: {
    offline: "Sie sind offline. Netzwerkabhängige Aktionen sind nicht verfügbar.",
    blocked: "Aktion blockiert. Stellen Sie die Verbindung wieder her.",
    reconnecting: "Live-Aktualisierungen werden wieder verbunden…",
  },
} as const;

export function ConnectivityBanner() {
  const { status, blockedAction } = useConnectivity();
  const { lang } = useLang();
  if (status === "online") return null;
  const message = status === "offline" && blockedAction ? copy[lang].blocked : copy[lang][status];
  const Icon = status === "offline" ? WifiOff : Wifi;

  return (
    <Alert
      aria-live="polite"
      className="rounded-none border-x-0 border-t-0 border-primary/30 bg-background/95 text-foreground"
    >
      <Icon aria-hidden="true" className="size-4" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}