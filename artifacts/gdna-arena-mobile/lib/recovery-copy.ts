// Follows the app's existing language mechanism (no in-app language setting
// exists): supported device locale, otherwise Arabic by default.
type Copy = {
  entry: string; title: string; intro: string; statusActive: string; statusNone: string; expires: string;
  loading: string; loadError: string; retry: string; password: string; passwordHint: string;
  generate: string; rotate: string; remove: string; removing: string; generating: string;
  rotateWarn: string; lostResponse: string; internet: string; offline: string;
  shownOnce: string; ack: string; done: string; removed: string; issued: string;
  errCredentials: string; errRate: string; errGeneric: string; errExpired: string;
  recoverLink: string; recoverTitle: string; recoverIntro: string; code: string; codeHint: string;
  newPassword: string; confirmPassword: string; mismatch: string; tooShort: string; tooLong: string; submit: string; submitting: string;
  preserved: string; e2ee: string; revoked: string; offlineCopies: string;
  successTitle: string; successBody: string; pending: string; backToLogin: string; back: string;
};

const ar: Copy = {
  entry: 'رمز الاسترداد دون اتصال', title: 'رمز استرداد الحساب', intro: 'رمز احتياطي يُستخدم مرة واحدة لإعادة تعيين كلمة المرور إذا فقدت الوصول. صالح لمدة سنة.',
  statusActive: 'يوجد رمز استرداد نشط', statusNone: 'لا يوجد رمز استرداد', expires: 'ينتهي في', loading: 'جارٍ التحميل…', loadError: 'تعذّر تحميل حالة الاسترداد.', retry: 'إعادة المحاولة',
  password: 'كلمة المرور الحالية', passwordHint: 'مطلوبة للتحقق من هويتك', generate: 'إنشاء رمز', rotate: 'استبدال الرمز', remove: 'إزالة الرمز', removing: 'جارٍ الإزالة…', generating: 'جارٍ الإنشاء…',
  rotateWarn: 'إنشاء رمز جديد يُبطل الرمز السابق فورًا.', lostResponse: 'إذا انقطع الاتصال قبل ظهور الرمز، أنشئ رمزًا جديدًا.', internet: 'يتطلب الإنشاء والاسترداد اتصالًا بالإنترنت.', offline: 'أنت غير متصل. اتصل بالإنترنت للمتابعة.',
  shownOnce: 'يظهر هذا الرمز مرة واحدة فقط. احفظه في مكان آمن خارج هذا الجهاز.', ack: 'حفظت الرمز بأمان خارج الجهاز', done: 'تم', removed: 'تمت إزالة رمز الاسترداد.', issued: 'رمزك الجديد',
  errCredentials: 'كلمة المرور أو الرمز غير صحيح.', errRate: 'محاولات كثيرة. انتظر ثم أعد المحاولة.', errGeneric: 'حدث خطأ. أعد المحاولة.', errExpired: 'الرمز غير صالح أو منتهي أو مستخدم.',
  recoverLink: 'استرداد الحساب برمز', recoverTitle: 'الاسترداد برمز', recoverIntro: 'أدخل رمز الاسترداد واختر كلمة مرور جديدة.', code: 'رمز الاسترداد', codeHint: 'الرمز المحفوظ',
  newPassword: 'كلمة المرور الجديدة', confirmPassword: 'تأكيد كلمة المرور', mismatch: 'كلمتا المرور غير متطابقتين.', tooShort: 'يجب أن تكون كلمة المرور 6 أحرف على الأقل.', tooLong: 'كلمة المرور طويلة جدًا (72 بايت كحد أقصى).', submit: 'إعادة تعيين كلمة المرور', submitting: 'جارٍ إعادة التعيين…',
  preserved: 'يبقى حسابك ورصيدك ورسائلك محفوظة.', e2ee: 'لا يمكن فك تشفير سجل الرسائل المشفرة بالكامل دون مفاتيح الجهاز القديم.', revoked: 'سيتم إلغاء جميع الجلسات والأجهزة القديمة.', offlineCopies: 'لا يمكن مسح النسخ المحفوظة دون اتصال على الأجهزة القديمة.',
  successTitle: 'تمت إعادة تعيين كلمة المرور', successBody: 'سجّل الدخول باسم المستخدم:', pending: 'أُلغيت جلسات التطبيق. ما زال إبطال وصول مزوّد الإشعارات الخارجي قيد المحاولة وسيُعاد تلقائيًا. يمكنك تسجيل الدخول الآن.', backToLogin: 'العودة لتسجيل الدخول', back: 'رجوع',
};
const en: Copy = {
  entry: 'Offline recovery code', title: 'Account recovery code', intro: 'A single-use backup code that resets your password if you lose access. Valid for one year.',
  statusActive: 'A recovery code is active', statusNone: 'No recovery code', expires: 'Expires', loading: 'Loading…', loadError: 'Could not load recovery status.', retry: 'Retry',
  password: 'Current password', passwordHint: 'Required to verify it is you', generate: 'Generate code', rotate: 'Replace code', remove: 'Remove code', removing: 'Removing…', generating: 'Generating…',
  rotateWarn: 'Generating a new code immediately invalidates the previous one.', lostResponse: 'If the connection drops before the code appears, generate a new one.', internet: 'Issuing and redeeming require an internet connection.', offline: 'You are offline. Connect to continue.',
  shownOnce: 'This code is shown only once. Save it somewhere secure outside this device.', ack: 'I saved the code securely outside this device', done: 'Done', removed: 'Recovery code removed.', issued: 'Your new code',
  errCredentials: 'Incorrect password or code.', errRate: 'Too many attempts. Wait and try again.', errGeneric: 'Something went wrong. Try again.', errExpired: 'The code is invalid, expired or already used.',
  recoverLink: 'Recover with a code', recoverTitle: 'Recover with a code', recoverIntro: 'Enter your recovery code and choose a new password.', code: 'Recovery code', codeHint: 'Your saved code',
  newPassword: 'New password', confirmPassword: 'Confirm password', mismatch: 'Passwords do not match.', tooShort: 'Password must be at least 6 characters.', tooLong: 'Password is too long (72 bytes maximum).', submit: 'Reset password', submitting: 'Resetting…',
  preserved: 'Your account, quota and messages are preserved.', e2ee: 'End-to-end encrypted history cannot be decrypted without the old device keys.', revoked: 'All old sessions and devices will be revoked.', offlineCopies: 'Offline copies on old devices cannot be erased.',
  successTitle: 'Password reset', successBody: 'Sign in normally with username:', pending: 'App sessions are revoked. External notification-provider access is still being revoked and will be retried. You can sign in now.', backToLogin: 'Back to sign in', back: 'Back',
};
const fr: Copy = {
  ...en,
  entry: 'Code de récupération hors ligne', title: 'Code de récupération du compte', intro: 'Code de secours à usage unique pour réinitialiser votre mot de passe. Valable un an.',
  statusActive: 'Un code de récupération est actif', statusNone: 'Aucun code de récupération', expires: 'Expire le', loading: 'Chargement…', loadError: 'Impossible de charger l’état.', retry: 'Réessayer',
  password: 'Mot de passe actuel', passwordHint: 'Requis pour vérifier votre identité', generate: 'Générer un code', rotate: 'Remplacer le code', remove: 'Supprimer le code', removing: 'Suppression…', generating: 'Génération…',
  rotateWarn: 'Un nouveau code invalide immédiatement le précédent.', lostResponse: 'Si la connexion coupe avant l’affichage du code, générez-en un nouveau.', internet: 'L’émission et l’utilisation exigent une connexion Internet.', offline: 'Vous êtes hors ligne. Connectez-vous pour continuer.',
  shownOnce: 'Ce code n’est affiché qu’une fois. Conservez-le en lieu sûr hors de cet appareil.', ack: 'J’ai conservé le code en lieu sûr hors de cet appareil', done: 'Terminé', removed: 'Code supprimé.', issued: 'Votre nouveau code',
  errCredentials: 'Mot de passe ou code incorrect.', errRate: 'Trop de tentatives. Patientez.', errGeneric: 'Une erreur est survenue. Réessayez.', errExpired: 'Code invalide, expiré ou déjà utilisé.',
  recoverLink: 'Récupérer avec un code', recoverTitle: 'Récupérer avec un code', recoverIntro: 'Saisissez votre code et choisissez un nouveau mot de passe.', code: 'Code de récupération', codeHint: 'Votre code enregistré',
  newPassword: 'Nouveau mot de passe', confirmPassword: 'Confirmer le mot de passe', mismatch: 'Les mots de passe ne correspondent pas.', tooShort: 'Le mot de passe doit contenir au moins 6 caractères.', tooLong: 'Mot de passe trop long (72 octets maximum).', submit: 'Réinitialiser', submitting: 'Réinitialisation…',
  preserved: 'Votre compte, quota et messages sont conservés.', e2ee: 'L’historique chiffré de bout en bout ne peut être déchiffré sans les clés de l’ancien appareil.', revoked: 'Toutes les anciennes sessions et appareils seront révoqués.', offlineCopies: 'Les copies hors ligne sur les anciens appareils ne peuvent être effacées.',
  successTitle: 'Mot de passe réinitialisé', successBody: 'Connectez-vous normalement avec :', pending: 'Les sessions de l’application sont révoquées. La révocation chez le fournisseur externe de notifications sera réessayée. Vous pouvez vous connecter.', backToLogin: 'Retour à la connexion', back: 'Retour',
};
const es: Copy = {
  ...en,
  entry: 'Código de recuperación sin conexión', title: 'Código de recuperación de cuenta', intro: 'Código de respaldo de un solo uso para restablecer tu contraseña. Válido un año.',
  statusActive: 'Hay un código activo', statusNone: 'Sin código de recuperación', expires: 'Caduca', loading: 'Cargando…', loadError: 'No se pudo cargar el estado.', retry: 'Reintentar',
  password: 'Contraseña actual', passwordHint: 'Necesaria para verificar tu identidad', generate: 'Generar código', rotate: 'Reemplazar código', remove: 'Eliminar código', removing: 'Eliminando…', generating: 'Generando…',
  rotateWarn: 'Un código nuevo invalida inmediatamente el anterior.', lostResponse: 'Si la conexión se corta antes de ver el código, genera uno nuevo.', internet: 'Emitir y canjear requieren conexión a Internet.', offline: 'Sin conexión. Conéctate para continuar.',
  shownOnce: 'Este código se muestra una sola vez. Guárdalo en un lugar seguro fuera de este dispositivo.', ack: 'Guardé el código de forma segura fuera del dispositivo', done: 'Listo', removed: 'Código eliminado.', issued: 'Tu nuevo código',
  errCredentials: 'Contraseña o código incorrecto.', errRate: 'Demasiados intentos. Espera.', errGeneric: 'Algo salió mal. Reintenta.', errExpired: 'Código inválido, caducado o ya usado.',
  recoverLink: 'Recuperar con un código', recoverTitle: 'Recuperar con un código', recoverIntro: 'Introduce tu código y elige una contraseña nueva.', code: 'Código de recuperación', codeHint: 'Tu código guardado',
  newPassword: 'Contraseña nueva', confirmPassword: 'Confirmar contraseña', mismatch: 'Las contraseñas no coinciden.', tooShort: 'La contraseña debe tener al menos 6 caracteres.', tooLong: 'Contraseña demasiado larga (máximo 72 bytes).', submit: 'Restablecer contraseña', submitting: 'Restableciendo…',
  preserved: 'Tu cuenta, cuota y mensajes se conservan.', e2ee: 'El historial cifrado de extremo a extremo no puede descifrarse sin las claves del dispositivo anterior.', revoked: 'Se revocarán todas las sesiones y dispositivos anteriores.', offlineCopies: 'Las copias sin conexión en dispositivos anteriores no pueden borrarse.',
  successTitle: 'Contraseña restablecida', successBody: 'Inicia sesión normalmente con el usuario:', pending: 'Las sesiones de la aplicación están revocadas. Se reintentará revocar el acceso al proveedor externo de notificaciones. Ya puedes iniciar sesión.', backToLogin: 'Volver a iniciar sesión', back: 'Atrás',
};
const de: Copy = {
  ...en,
  entry: 'Offline-Wiederherstellungscode', title: 'Konto-Wiederherstellungscode', intro: 'Einmaliger Backup-Code zum Zurücksetzen des Passworts. Ein Jahr gültig.',
  statusActive: 'Ein Wiederherstellungscode ist aktiv', statusNone: 'Kein Wiederherstellungscode', expires: 'Läuft ab', loading: 'Wird geladen…', loadError: 'Status konnte nicht geladen werden.', retry: 'Erneut versuchen',
  password: 'Aktuelles Passwort', passwordHint: 'Zur Bestätigung Ihrer Identität erforderlich', generate: 'Code erstellen', rotate: 'Code ersetzen', remove: 'Code entfernen', removing: 'Wird entfernt…', generating: 'Wird erstellt…',
  rotateWarn: 'Ein neuer Code macht den vorherigen sofort ungültig.', lostResponse: 'Bricht die Verbindung ab, bevor der Code erscheint, erstellen Sie einen neuen.', internet: 'Erstellen und Einlösen erfordern eine Internetverbindung.', offline: 'Sie sind offline. Verbinden Sie sich, um fortzufahren.',
  shownOnce: 'Dieser Code wird nur einmal angezeigt. Bewahren Sie ihn sicher außerhalb dieses Geräts auf.', ack: 'Ich habe den Code sicher außerhalb des Geräts gespeichert', done: 'Fertig', removed: 'Code entfernt.', issued: 'Ihr neuer Code',
  errCredentials: 'Passwort oder Code falsch.', errRate: 'Zu viele Versuche. Bitte warten.', errGeneric: 'Etwas ist schiefgelaufen. Erneut versuchen.', errExpired: 'Code ungültig, abgelaufen oder bereits verwendet.',
  recoverLink: 'Mit Code wiederherstellen', recoverTitle: 'Mit Code wiederherstellen', recoverIntro: 'Geben Sie Ihren Code ein und wählen Sie ein neues Passwort.', code: 'Wiederherstellungscode', codeHint: 'Ihr gespeicherter Code',
  newPassword: 'Neues Passwort', confirmPassword: 'Passwort bestätigen', mismatch: 'Passwörter stimmen nicht überein.', tooShort: 'Das Passwort muss mindestens 6 Zeichen haben.', tooLong: 'Passwort zu lang (maximal 72 Byte).', submit: 'Passwort zurücksetzen', submitting: 'Wird zurückgesetzt…',
  preserved: 'Konto, Kontingent und Nachrichten bleiben erhalten.', e2ee: 'Ende-zu-Ende-verschlüsselter Verlauf kann ohne die alten Geräteschlüssel nicht entschlüsselt werden.', revoked: 'Alle alten Sitzungen und Geräte werden widerrufen.', offlineCopies: 'Offline-Kopien auf alten Geräten können nicht gelöscht werden.',
  successTitle: 'Passwort zurückgesetzt', successBody: 'Melden Sie sich normal an mit Benutzername:', pending: 'App-Sitzungen sind widerrufen. Der Zugriff beim externen Benachrichtigungsanbieter wird erneut widerrufen. Sie können sich jetzt anmelden.', backToLogin: 'Zurück zur Anmeldung', back: 'Zurück',
};

const all = { ar, en, fr, es, de } as const;

export function recoveryCopy(): Copy {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2);
  return all[locale as keyof typeof all] ?? all.ar;
}
