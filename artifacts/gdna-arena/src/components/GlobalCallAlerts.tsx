import { useState } from "react";
import { BellRing, ShieldAlert, Volume2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@workspace/gdna-ds/components/ui/alert";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { useLang, type Lang } from "@/contexts/LangContext";
import type { useCall } from "@/hooks/useCall";

type CallAlertsState = Pick<
  ReturnType<typeof useCall>,
  | "callStatus"
  | "soundBlocked"
  | "enableCallSound"
  | "notificationPermission"
  | "enableCallNotifications"
  | "pushEnabled"
  | "pushReason"
  | "firebaseStatus"
  | "secureCallRegistrationStatus"
  | "secureCallRegistrationError"
  | "retrySecureCallRegistration"
>;

const COPY: Record<Lang, {
  title: string;
  setup: string;
  enabling: string;
  enable: string;
  enableSound: string;
  registering: string;
  secureError: string;
  retry: string;
  denied: string;
  unsupported: string;
  unavailable: string;
  soundOnly: string;
}> = {
  en: {
    title: "Enable call alerts",
    setup: "Enable ringtone sound and browser notifications so incoming calls can reach you on any page.",
    enabling: "Enabling…",
    enable: "Enable call alerts",
    enableSound: "Enable ringtone",
    registering: "Preparing secure incoming calls on this device…",
    secureError: "Secure incoming calls are not ready on this device.",
    retry: "Retry",
    denied: "Browser notifications are blocked. Allow them in this site's browser settings, then return here.",
    unsupported: "This browser does not support call notifications. Keep this page open to receive calls.",
    unavailable: "Background call notifications are currently unavailable.",
    soundOnly: "Ringtone sound is off. Enable it to hear incoming calls while this page is open.",
  },
  ar: {
    title: "فعّل تنبيهات المكالمات",
    setup: "فعّل نغمة الرنين وإشعارات المتصفح لتصلك المكالمات الواردة في أي صفحة.",
    enabling: "جارٍ التفعيل…",
    enable: "تفعيل تنبيهات المكالمات",
    enableSound: "تفعيل نغمة الرنين",
    registering: "جارٍ تجهيز المكالمات الواردة الآمنة على هذا الجهاز…",
    secureError: "المكالمات الواردة الآمنة غير جاهزة على هذا الجهاز.",
    retry: "إعادة المحاولة",
    denied: "إشعارات المتصفح محظورة. اسمح بها من إعدادات المتصفح لهذا الموقع ثم عُد إلى هنا.",
    unsupported: "هذا المتصفح لا يدعم إشعارات المكالمات. أبقِ هذه الصفحة مفتوحة لاستقبال المكالمات.",
    unavailable: "إشعارات المكالمات في الخلفية غير متاحة حالياً.",
    soundOnly: "نغمة الرنين متوقفة. فعّلها لسماع المكالمات الواردة أثناء فتح الصفحة.",
  },
  fr: {
    title: "Activer les alertes d'appel",
    setup: "Activez la sonnerie et les notifications du navigateur pour recevoir les appels sur toutes les pages.",
    enabling: "Activation…",
    enable: "Activer les alertes d'appel",
    enableSound: "Activer la sonnerie",
    registering: "Préparation des appels entrants sécurisés sur cet appareil…",
    secureError: "Les appels entrants sécurisés ne sont pas prêts sur cet appareil.",
    retry: "Réessayer",
    denied: "Les notifications sont bloquées. Autorisez-les dans les paramètres du navigateur pour ce site.",
    unsupported: "Ce navigateur ne prend pas en charge les notifications d'appel. Gardez cette page ouverte.",
    unavailable: "Les notifications d'appel en arrière-plan sont actuellement indisponibles.",
    soundOnly: "La sonnerie est désactivée. Activez-la pour entendre les appels lorsque cette page est ouverte.",
  },
  es: {
    title: "Activar alertas de llamadas",
    setup: "Activa el tono y las notificaciones del navegador para recibir llamadas desde cualquier página.",
    enabling: "Activando…",
    enable: "Activar alertas de llamadas",
    enableSound: "Activar tono",
    registering: "Preparando llamadas entrantes seguras en este dispositivo…",
    secureError: "Las llamadas entrantes seguras no están listas en este dispositivo.",
    retry: "Reintentar",
    denied: "Las notificaciones están bloqueadas. Permítelas en la configuración del navegador para este sitio.",
    unsupported: "Este navegador no admite notificaciones de llamadas. Mantén esta página abierta.",
    unavailable: "Las notificaciones de llamadas en segundo plano no están disponibles actualmente.",
    soundOnly: "El tono está desactivado. Actívalo para oír llamadas mientras esta página esté abierta.",
  },
  de: {
    title: "Anrufbenachrichtigungen aktivieren",
    setup: "Aktiviere Klingelton und Browser-Benachrichtigungen, um Anrufe auf jeder Seite zu empfangen.",
    enabling: "Wird aktiviert…",
    enable: "Anrufbenachrichtigungen aktivieren",
    enableSound: "Klingelton aktivieren",
    registering: "Sichere eingehende Anrufe werden auf diesem Gerät vorbereitet…",
    secureError: "Sichere eingehende Anrufe sind auf diesem Gerät nicht bereit.",
    retry: "Erneut versuchen",
    denied: "Browser-Benachrichtigungen sind blockiert. Erlaube sie in den Website-Einstellungen des Browsers.",
    unsupported: "Dieser Browser unterstützt keine Anrufbenachrichtigungen. Lass diese Seite geöffnet.",
    unavailable: "Anrufbenachrichtigungen im Hintergrund sind derzeit nicht verfügbar.",
    soundOnly: "Der Klingelton ist aus. Aktiviere ihn, um Anrufe bei geöffneter Seite zu hören.",
  },
};

export function GlobalCallAlerts({ call }: { call: CallAlertsState }) {
  const { lang } = useLang();
  const copy = COPY[lang];
  const [enabling, setEnabling] = useState(false);

  const readinessStatus = (
    <span className="sr-only" data-testid="call-readiness-status" aria-live="polite">
      {call.secureCallRegistrationStatus}
    </span>
  );

  // The full-screen incoming/active call UI remains the only call-time surface.
  if (call.callStatus !== "idle" && call.callStatus !== "ended") return readinessStatus;

  const registerError = call.secureCallRegistrationStatus === "error";
  const registering = call.secureCallRegistrationStatus === "registering";
  const permissionNeedsChoice = call.notificationPermission === "default";
  const denied = call.notificationPermission === "denied";
  const unsupported = call.notificationPermission === "unsupported";
  const backgroundUnavailable =
    !permissionNeedsChoice && !denied && !unsupported &&
    (!call.pushEnabled || call.firebaseStatus === "error");
  const needsAlert =
    registering || registerError || call.soundBlocked || permissionNeedsChoice ||
    denied || unsupported || backgroundUnavailable;

  if (!needsAlert) return readinessStatus;

  const enable = async () => {
    setEnabling(true);
    try {
      await call.enableCallSound();
      if (permissionNeedsChoice) await call.enableCallNotifications();
    } finally {
      setEnabling(false);
    }
  };

  let description = copy.setup;
  if (registering) description = copy.registering;
  else if (registerError) {
    description = `${copy.secureError}${call.secureCallRegistrationError ? ` ${call.secureCallRegistrationError}` : ""}`;
  } else if (denied) description = copy.denied;
  else if (unsupported) description = copy.unsupported;
  else if (backgroundUnavailable) description = call.pushReason || copy.unavailable;
  else if (!permissionNeedsChoice && call.soundBlocked) description = copy.soundOnly;

  return (
    <>
      {readinessStatus}
      <div
        className="fixed inset-x-3 bottom-3 z-[80] mx-auto max-w-xl"
        dir={lang === "ar" ? "rtl" : "ltr"}
        data-testid="global-call-alerts"
      >
        <Alert
          variant={registerError ? "destructive" : "default"}
          className="border-border bg-card/95 shadow-xl backdrop-blur"
        >
          {registerError ? <ShieldAlert aria-hidden="true" /> : call.soundBlocked ? <Volume2 aria-hidden="true" /> : <BellRing aria-hidden="true" />}
          <AlertTitle>{copy.title}</AlertTitle>
          <AlertDescription>
            <p>{description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {registerError && (
                <Button size="sm" variant="outline" onClick={call.retrySecureCallRegistration} data-testid="call-registration-retry">
                  {copy.retry}
                </Button>
              )}
              {!registering && !registerError && (call.soundBlocked || permissionNeedsChoice) && (
                <Button
                  size="sm"
                  onClick={enable}
                  disabled={enabling}
                  data-testid="enable-call-alerts-button"
                >
                  {enabling ? copy.enabling : permissionNeedsChoice ? copy.enable : copy.enableSound}
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      </div>
    </>
  );
}

export default GlobalCallAlerts;