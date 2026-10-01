// Follows the app's existing language mechanism (no in-app language setting
// exists): supported device locale, otherwise Arabic by default.
type Copy = {
  singleAccountNotice: string;
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
  singleAccountNotice: 'سجّل مرة واحدة من أي تبويب في المنصة — الحساب نفسه لجميع الأقسام. على جهاز جديد أو بعد فقدان جهازك، سجّل الدخول بحسابك الحالي أو استعده؛ لا تنشئ حساباً جديداً.\n\nتبقى عادةً مسجّل الدخول على الجهاز نفسه. مسح بيانات التطبيق أو المتصفح أو تسجيل الخروج أو انتهاء الجلسة أو إلغاؤها لأسباب أمنية يتطلب تسجيل الدخول مجدداً.\n\nالحساب الواحد لا يلغي شروط الوصول: الألعاب تتطلب 18+، وتظل شروط اشتراك المراسلة سارية.',
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
  singleAccountNotice: 'Register once from any platform tab — use the same account across all sections. On a new device or after losing your device, sign in to your existing account or recover it; do not register again.\n\nYou normally stay signed in on the same device. Clearing app or browser data, signing out, session expiry or security revocation requires signing in again.\n\nOne account does not bypass access rules: Games requires 18+, and messaging subscription requirements still apply.',
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
  singleAccountNotice: 'Inscrivez-vous une seule fois depuis n’importe quel onglet de la plateforme — le même compte sert dans toutes les sections. Sur un nouvel appareil ou après la perte du vôtre, connectez-vous à votre compte existant ou récupérez-le ; ne vous réinscrivez pas.\n\nVous restez normalement connecté sur le même appareil. Effacer les données de l’application ou du navigateur, se déconnecter, l’expiration ou la révocation de la session pour sécurité impose une nouvelle connexion.\n\nUn seul compte ne supprime pas les règles d’accès : les jeux exigent 18 ans ou plus et les conditions d’abonnement à la messagerie restent applicables.',
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
  singleAccountNotice: 'Regístrate una sola vez desde cualquier pestaña de la plataforma — usa la misma cuenta en todas las secciones. En un dispositivo nuevo o si pierdes el tuyo, inicia sesión con tu cuenta existente o recupérala; no vuelvas a registrarte.\n\nNormalmente mantienes la sesión en el mismo dispositivo. Borrar los datos de la aplicación o del navegador, cerrar sesión, su caducidad o revocación por seguridad requiere iniciar sesión de nuevo.\n\nUna cuenta no elimina las reglas de acceso: los juegos requieren 18 años o más y siguen vigentes los requisitos de suscripción de mensajería.',
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
  singleAccountNotice: 'Registriere dich einmal über einen beliebigen Plattform-Tab — dasselbe Konto gilt für alle Bereiche. Melde dich auf einem neuen Gerät oder nach Geräteverlust mit deinem bestehenden Konto an oder stelle es wieder her; registriere dich nicht erneut.\n\nDu bleibst normalerweise auf demselben Gerät angemeldet. Gelöschte App- oder Browserdaten, Abmeldung, Sitzungsablauf oder Widerruf aus Sicherheitsgründen erfordern eine erneute Anmeldung.\n\nEin Konto hebt keine Zugangsregeln auf: Spiele erfordern ein Mindestalter von 18 Jahren und die Abonnementbedingungen für Nachrichten gelten weiterhin.',
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

// Phone access uses the same device-localized copy source as backup recovery.
const phoneEn = {
  link: 'Forgot password? Sign in by SMS',
  title: 'Sign in by SMS',
  intro: 'Use the phone number already verified in your account settings to sign in to your existing account. No new password or new account is needed. Accounts without a verified number cannot use SMS access.',
  phone: 'Verified recovery number', phoneHint: 'Include + and the country calling code.',
  invalidPhone: 'Enter the full number with + and country calling code (8–15 digits).',
  consent: 'I agree to receive an SMS for phone verification.',
  consentRequired: 'Agree to SMS phone verification before requesting a code.',
  privacy: 'Firebase processes the phone number to verify it and prevent abuse. Carrier charges may apply. Anyone who controls this number can access your account.',
  send: 'Send verification SMS', wait: 'Seconds before requesting again:',
  code: 'SMS verification code', invalidCode: 'Enter the 6-digit SMS code.',
  sent: 'Firebase accepted the SMS request. Enter the code when it arrives.',
  automatic: 'Android verified this phone automatically.',
  confirm: 'Verify and sign in', restart: 'Start over / request another code',
  fresh: 'Request a fresh SMS verification before retrying.',
  pending: 'SMS access was accepted, but the new session could not yet be verified. Retry the saved session; do not request another SMS.',
  retry: 'Verify saved session', success: 'Signed in to your existing account. Old sessions and devices have been revoked. Your password was not changed.',
  done: 'Continue to your account',
  delivery: 'Each SMS challenge is single-use. Firebase SMS delivery and app validation depend on project configuration and your carrier.',
};
type PhoneCopy = typeof phoneEn;
const phoneAll: Record<'ar' | 'en' | 'fr' | 'es' | 'de', PhoneCopy> = {
  en: phoneEn,
  ar: {
    link: 'نسيت كلمة المرور؟ ادخل عبر SMS', title: 'الدخول عبر SMS',
    intro: 'استخدم الرقم الذي سبق التحقق منه في إعدادات حسابك للدخول إلى حسابك الحالي. لا تحتاج إلى كلمة مرور جديدة أو حساب جديد. لا يمكن استخدام SMS دون رقم موثّق.',
    phone: 'رقم الاسترداد الموثّق', phoneHint: 'أضف + ورمز الاتصال الدولي.',
    invalidPhone: 'أدخل الرقم كاملاً مع + ورمز الدولة (8–15 رقماً).',
    consent: 'أوافق على تلقي SMS للتحقق من رقم الهاتف.', consentRequired: 'وافق على التحقق عبر SMS قبل طلب الرمز.',
    privacy: 'تعالج Firebase الرقم للتحقق منه ومنع إساءة الاستخدام. قد تطبق رسوم شركة الاتصالات. من يتحكم في هذا الرقم يستطيع الوصول إلى حسابك.',
    send: 'إرسال SMS للتحقق', wait: 'الثواني المتبقية لطلب آخر:', code: 'رمز التحقق عبر SMS', invalidCode: 'أدخل رمز SMS المكوّن من 6 أرقام.',
    sent: 'قبلت Firebase طلب SMS. أدخل الرمز عند وصوله.', automatic: 'تحقّق Android من هذا الهاتف تلقائياً.',
    confirm: 'تحقّق وسجّل الدخول', restart: 'البدء من جديد / طلب رمز آخر', fresh: 'اطلب تحققاً جديداً عبر SMS قبل إعادة المحاولة.',
    pending: 'تم قبول الدخول عبر SMS، لكن تعذّر التحقق من الجلسة الجديدة بعد. أعد التحقق من الجلسة المحفوظة دون طلب SMS آخر.',
    retry: 'التحقق من الجلسة المحفوظة', success: 'تم الدخول إلى حسابك الحالي وإلغاء الجلسات والأجهزة القديمة. لم تتغير كلمة المرور.',
    done: 'المتابعة إلى حسابك', delivery: 'كل محاولة تحقق تُستخدم مرة واحدة. يعتمد وصول SMS والتحقق من التطبيق على إعدادات Firebase وشركة الاتصالات.',
  },
  fr: {
    link: 'Mot de passe oublié ? Connexion par SMS', title: 'Connexion par SMS',
    intro: 'Utilisez le numéro déjà vérifié dans les paramètres pour accéder à votre compte existant. Aucun nouveau mot de passe ni nouveau compte requis. Sans numéro vérifié, l’accès par SMS est impossible.',
    phone: 'Numéro de récupération vérifié', phoneHint: 'Incluez + et l’indicatif du pays.', invalidPhone: 'Saisissez le numéro complet avec + et l’indicatif (8–15 chiffres).',
    consent: 'J’accepte de recevoir un SMS de vérification.', consentRequired: 'Acceptez la vérification par SMS avant de demander un code.',
    privacy: 'Firebase traite le numéro pour le vérifier et prévenir les abus. Des frais opérateur peuvent s’appliquer. Toute personne contrôlant ce numéro peut accéder à votre compte.',
    send: 'Envoyer le SMS de vérification', wait: 'Secondes avant une nouvelle demande :', code: 'Code de vérification SMS', invalidCode: 'Saisissez le code SMS à 6 chiffres.',
    sent: 'Firebase a accepté la demande SMS. Saisissez le code à son arrivée.', automatic: 'Android a vérifié ce téléphone automatiquement.',
    confirm: 'Vérifier et se connecter', restart: 'Recommencer / demander un autre code', fresh: 'Demandez une nouvelle vérification SMS avant de réessayer.',
    pending: 'L’accès SMS a été accepté, mais la nouvelle session n’a pas encore pu être vérifiée. Réessayez la session enregistrée sans demander un autre SMS.',
    retry: 'Vérifier la session enregistrée', success: 'Connexion à votre compte existant. Les anciennes sessions et appareils ont été révoqués. Votre mot de passe reste inchangé.',
    done: 'Continuer vers votre compte', delivery: 'Chaque vérification SMS est à usage unique. La livraison et la validation de l’application dépendent de Firebase et de votre opérateur.',
  },
  es: {
    link: '¿Olvidaste la contraseña? Accede por SMS', title: 'Acceder por SMS',
    intro: 'Usa el número ya verificado en los ajustes para acceder a tu cuenta existente. No necesitas una contraseña ni una cuenta nueva. Sin número verificado no es posible acceder por SMS.',
    phone: 'Número de recuperación verificado', phoneHint: 'Incluye + y el prefijo del país.', invalidPhone: 'Introduce el número completo con + y prefijo (8–15 dígitos).',
    consent: 'Acepto recibir un SMS de verificación.', consentRequired: 'Acepta la verificación por SMS antes de solicitar un código.',
    privacy: 'Firebase procesa el número para verificarlo y evitar abusos. Pueden aplicarse tarifas del operador. Quien controle este número puede acceder a tu cuenta.',
    send: 'Enviar SMS de verificación', wait: 'Segundos antes de otra solicitud:', code: 'Código de verificación SMS', invalidCode: 'Introduce el código SMS de 6 dígitos.',
    sent: 'Firebase aceptó la solicitud SMS. Introduce el código cuando llegue.', automatic: 'Android verificó este teléfono automáticamente.',
    confirm: 'Verificar e iniciar sesión', restart: 'Empezar de nuevo / pedir otro código', fresh: 'Solicita una nueva verificación SMS antes de reintentar.',
    pending: 'Se aceptó el acceso por SMS, pero aún no se pudo verificar la nueva sesión. Reintenta la sesión guardada sin solicitar otro SMS.',
    retry: 'Verificar sesión guardada', success: 'Has accedido a tu cuenta existente. Se revocaron las sesiones y dispositivos anteriores. Tu contraseña no cambió.',
    done: 'Continuar a tu cuenta', delivery: 'Cada verificación SMS es de un solo uso. La entrega y validación de la aplicación dependen de Firebase y del operador.',
  },
  de: {
    link: 'Passwort vergessen? Per SMS anmelden', title: 'Per SMS anmelden',
    intro: 'Nutze die bereits in den Einstellungen verifizierte Nummer, um dich bei deinem bestehenden Konto anzumelden. Kein neues Passwort oder Konto nötig. Ohne verifizierte Nummer ist SMS-Zugang nicht möglich.',
    phone: 'Verifizierte Wiederherstellungsnummer', phoneHint: 'Mit + und Landesvorwahl.', invalidPhone: 'Vollständige Nummer mit + und Landesvorwahl eingeben (8–15 Ziffern).',
    consent: 'Ich stimme einer SMS zur Telefonverifizierung zu.', consentRequired: 'Stimme vor der Code-Anforderung der SMS-Verifizierung zu.',
    privacy: 'Firebase verarbeitet die Nummer zur Verifizierung und Missbrauchsprävention. Mobilfunkgebühren können anfallen. Wer diese Nummer kontrolliert, kann auf dein Konto zugreifen.',
    send: 'Verifizierungs-SMS senden', wait: 'Sekunden bis zur nächsten Anfrage:', code: 'SMS-Verifizierungscode', invalidCode: 'Gib den 6-stelligen SMS-Code ein.',
    sent: 'Firebase hat die SMS-Anfrage angenommen. Gib den Code ein, sobald er ankommt.', automatic: 'Android hat dieses Telefon automatisch verifiziert.',
    confirm: 'Verifizieren und anmelden', restart: 'Neu beginnen / anderen Code anfordern', fresh: 'Fordere vor einem erneuten Versuch eine neue SMS-Verifizierung an.',
    pending: 'Der SMS-Zugang wurde akzeptiert, die neue Sitzung konnte aber noch nicht verifiziert werden. Prüfe die gespeicherte Sitzung erneut, ohne eine weitere SMS anzufordern.',
    retry: 'Gespeicherte Sitzung prüfen', success: 'Bei deinem bestehenden Konto angemeldet. Alte Sitzungen und Geräte wurden widerrufen. Dein Passwort blieb unverändert.',
    done: 'Weiter zu deinem Konto', delivery: 'Jede SMS-Verifizierung ist einmalig. Zustellung und App-Validierung hängen von Firebase und deinem Mobilfunkanbieter ab.',
  },
};

export function phoneRecoveryCopy(): PhoneCopy {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2);
  return phoneAll[locale as keyof typeof phoneAll] ?? phoneAll.ar;
}
