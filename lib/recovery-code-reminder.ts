/** Only non-secret status metadata is accepted; never store or inspect the code. */
export function isRecoveryCodeExpiringSoon(
  status: { active: boolean; expiresAt: string | null } | undefined,
  now = Date.now(),
): boolean {
  if (!status?.active || !status.expiresAt) return false;
  const remaining = Date.parse(status.expiresAt) - now;
  return remaining > 0 && remaining <= 30 * 24 * 60 * 60 * 1000;
}

export function recoveryReminderPreferenceKey(userId: number): string {
  return `gdna:recovery-expiry-reminder:${userId}`;
}

const copy = {
  ar: {
    label: "ذكّرني قبل انتهاء رمز الاسترداد",
    hint: "اختياري: يظهر التذكير هنا فقط خلال آخر 30 يوماً من صلاحية الرمز. يُحفظ الاختيار لهذا الحساب على هذا الجهاز، دون إشعارات خارج الإعدادات.",
    warning: "تنتهي صلاحية رمز الاسترداد المحفوظ في {date}. يمكنك استبداله بعد تأكيد كلمة المرور؛ لن يتم إنشاء رمز جديد تلقائياً.",
    replace: "الانتقال إلى تأكيد كلمة المرور لاستبدال الرمز",
    storageError: "تعذّر حفظ أو قراءة اختيار التذكير على هذا الجهاز. أعد المحاولة.",
  },
  en: {
    label: "Remind me before my recovery code expires",
    hint: "Optional: a reminder appears only here during the code’s last 30 days. This preference is saved for this account on this device, with no notifications outside settings.",
    warning: "Your saved recovery code expires on {date}. You can replace it after confirming your password; no new code is created automatically.",
    replace: "Go to password confirmation to replace the code",
    storageError: "Could not save or read your reminder preference on this device. Please try again.",
  },
  fr: {
    label: "Me rappeler l’expiration de mon code de récupération",
    hint: "Facultatif : un rappel apparaît uniquement ici pendant les 30 derniers jours de validité. Ce choix est enregistré pour ce compte sur cet appareil, sans notification hors des paramètres.",
    warning: "Votre code de récupération enregistré expire le {date}. Vous pouvez le remplacer après confirmation de votre mot de passe ; aucun nouveau code n’est créé automatiquement.",
    replace: "Confirmer le mot de passe pour remplacer le code",
    storageError: "Impossible d’enregistrer ou de lire votre préférence de rappel sur cet appareil. Réessayez.",
  },
  es: {
    label: "Recordarme antes de que caduque mi código de recuperación",
    hint: "Opcional: el recordatorio aparece solo aquí durante los últimos 30 días de validez. La preferencia se guarda para esta cuenta en este dispositivo, sin notificaciones fuera de los ajustes.",
    warning: "Tu código de recuperación guardado caduca el {date}. Puedes reemplazarlo tras confirmar tu contraseña; no se crea un código nuevo automáticamente.",
    replace: "Ir a confirmar la contraseña para reemplazar el código",
    storageError: "No se pudo guardar o leer tu preferencia de recordatorio en este dispositivo. Inténtalo de nuevo.",
  },
  de: {
    label: "Mich vor Ablauf meines Wiederherstellungscodes erinnern",
    hint: "Optional: Die Erinnerung erscheint nur hier in den letzten 30 Tagen der Gültigkeit. Diese Einstellung wird für dieses Konto auf diesem Gerät gespeichert, ohne Benachrichtigungen außerhalb der Einstellungen.",
    warning: "Ihr gespeicherter Wiederherstellungscode läuft am {date} ab. Sie können ihn nach Bestätigung Ihres Passworts ersetzen; es wird kein neuer Code automatisch erstellt.",
    replace: "Zur Passwortbestätigung gehen, um den Code zu ersetzen",
    storageError: "Ihre Erinnerungseinstellung konnte auf diesem Gerät nicht gespeichert oder gelesen werden. Bitte versuchen Sie es erneut.",
  },
};

export function recoveryReminderCopy(lang: string) {
  return copy[lang as keyof typeof copy] ?? copy.ar;
}