import type { Lang } from "@/contexts/LangContext";

/**
 * Every string of the sign-in experience lives here, one complete set per language.
 * The UI picks ONE language object, so English and Arabic can never be mixed in a message.
 * The server only returns error codes; `errors` maps each code.
 */
export interface AuthCopy {
  login: string; signup: string; logout: string; language: string; account: string; dashboard: string;
  loginTitle: string; signupTitle: string; continueGoogle: string; continueEmail: string; orDivider: string;
  forgot: string; noAccount: string; haveAccount: string; close: string; back: string;
  name: string; email: string; emailOrUsername: string; password: string; newPassword: string;
  phone: string; phoneOptionalHint: string; countryCode: string; birthDate: string;
  submitLogin: string; submitSignup: string; working: string;
  forgotTitle: string; forgotIntro: string; sendCode: string; codeTitle: string; codeSentTo: (phone: string) => string;
  verify: string; resend: string; resendIn: (s: number) => string; skip: string;
  newPasswordTitle: string; savePassword: string; passwordChanged: string;
  deviceTitle: string; deviceBody: (phone: string) => string; deviceTrusted: string;
  phoneStepTitle: string; phoneStepBody: string; phoneVerified: string;
  devCode: string; googleUnavailable: string; smsMock: string;
  errors: Record<string, string>;
}

const en: AuthCopy = {
  login: "Log in", signup: "Sign up", logout: "Log out", language: "Language", account: "Account", dashboard: "Dashboard",
  loginTitle: "Welcome back", signupTitle: "Create your account", continueGoogle: "Continue with Google",
  continueEmail: "Continue with Email", orDivider: "or", forgot: "Forgot password?",
  noAccount: "New here? Sign up", haveAccount: "Already registered? Log in", close: "Close", back: "Back",
  name: "Name", email: "Email", emailOrUsername: "Email or username", password: "Password", newPassword: "New password",
  phone: "Phone number", phoneOptionalHint: "Needed to reset your password by SMS", countryCode: "Country code",
  birthDate: "Date of birth", submitLogin: "Log in", submitSignup: "Create account",
  working: "Please wait…", forgotTitle: "Reset your password", forgotIntro: "Enter the phone number linked to your account. We will text you a 6-digit code.",
  sendCode: "Send code", codeTitle: "Enter the code", codeSentTo: p => `We sent a 6-digit code to ${p}.`,
  verify: "Verify", resend: "Resend code", resendIn: s => `Resend in ${s}s`, skip: "Skip for now",
  newPasswordTitle: "Choose a new password", savePassword: "Save password", passwordChanged: "Password changed. Log in with your new password.",
  deviceTitle: "Verify this device", deviceBody: p => `For your security, enter the code we sent to ${p}. We will remember this device afterwards.`,
  deviceTrusted: "Device trusted.", phoneStepTitle: "Verify your phone", phoneStepBody: "Enter the code we texted you so you can recover your account by SMS.",
  phoneVerified: "Phone verified.", devCode: "Test code (SMS not configured)", googleUnavailable: "Google sign-in is not available right now.",
  smsMock: "SMS provider not configured: the code is printed in the server log.",
  errors: {
    INVALID_CREDENTIALS: "Incorrect email, username or password.", CREDENTIALS_REQUIRED: "Enter your email or username and your password.",
    EMAIL_INVALID: "Enter a valid email address.", EMAIL_TAKEN: "This email is already registered. Log in instead.",
    PASSWORD_WEAK: "Use at least 8 characters for the password.", NAME_INVALID: "Enter your name (at least 2 characters).",
    PHONE_INVALID: "Enter a valid phone number.", PHONE_TAKEN: "This phone number is linked to another account.",
    BIRTHDATE_INVALID: "Choose a valid date of birth.", OTP_INVALID: "That code is incorrect.", OTP_EXPIRED: "That code expired. Request a new one.",
    OTP_TOO_SOON: "Please wait a minute before requesting another code.", OTP_LIMIT: "Too many codes requested. Try again later.",
    OTP_ATTEMPTS: "Too many wrong attempts. Request a new code.", SMS_UNAVAILABLE: "SMS is not available right now.",
    SMS_FAILED: "We could not send the SMS. Try again.", RESET_INVALID: "This reset link expired. Start again.",
    GOOGLE_INVALID: "Google could not verify your account.", GOOGLE_UNAVAILABLE: "Google sign-in is not available right now.",
    TOO_MANY_ATTEMPTS: "Too many attempts. Wait 15 minutes and try again.", AUTH_REQUIRED: "Please log in first.",
    SERVER_ERROR: "Something went wrong. Please try again.", NETWORK: "Network problem. Check your connection.",
  },
};

const ar: AuthCopy = {
  login: "تسجيل الدخول", signup: "إنشاء حساب", logout: "تسجيل الخروج", language: "اللغة", account: "الحساب", dashboard: "لوحة التحكم",
  loginTitle: "مرحباً بعودتك", signupTitle: "أنشئ حسابك", continueGoogle: "المتابعة باستخدام Google",
  continueEmail: "المتابعة بالبريد الإلكتروني", orDivider: "أو", forgot: "نسيت كلمة السر؟",
  noAccount: "جديد هنا؟ أنشئ حساباً", haveAccount: "لديك حساب؟ سجّل الدخول", close: "إغلاق", back: "رجوع",
  name: "الاسم", email: "البريد الإلكتروني", emailOrUsername: "البريد الإلكتروني أو اسم المستخدم", password: "كلمة السر", newPassword: "كلمة سر جديدة",
  phone: "رقم الهاتف", phoneOptionalHint: "مطلوب لاستعادة كلمة السر عبر الرسائل النصية", countryCode: "رمز الدولة",
  birthDate: "تاريخ الميلاد", submitLogin: "تسجيل الدخول", submitSignup: "إنشاء الحساب",
  working: "يرجى الانتظار…", forgotTitle: "استعادة كلمة السر", forgotIntro: "أدخل رقم الهاتف المرتبط بحسابك وسنرسل لك رمزاً من 6 أرقام.",
  sendCode: "إرسال الرمز", codeTitle: "أدخل الرمز", codeSentTo: p => `أرسلنا رمزاً من 6 أرقام إلى ${p}.`,
  verify: "تأكيد", resend: "إعادة إرسال الرمز", resendIn: s => `إعادة الإرسال بعد ${s} ث`, skip: "تخطَّ الآن",
  newPasswordTitle: "اختر كلمة سر جديدة", savePassword: "حفظ كلمة السر", passwordChanged: "تم تغيير كلمة السر. سجّل الدخول بكلمة السر الجديدة.",
  deviceTitle: "تأكيد هذا الجهاز", deviceBody: p => `لحماية حسابك، أدخل الرمز الذي أرسلناه إلى ${p}. سنتذكر هذا الجهاز بعد ذلك.`,
  deviceTrusted: "تم اعتماد الجهاز.", phoneStepTitle: "تأكيد رقم هاتفك", phoneStepBody: "أدخل الرمز الذي أرسلناه إليك لتتمكن من استعادة حسابك عبر الرسائل النصية.",
  phoneVerified: "تم تأكيد الهاتف.", devCode: "رمز الاختبار (خدمة الرسائل غير مفعّلة)", googleUnavailable: "تسجيل الدخول عبر Google غير متاح حالياً.",
  smsMock: "مزود الرسائل غير مُعدّ: يظهر الرمز في سجل الخادم.",
  errors: {
    INVALID_CREDENTIALS: "البريد أو اسم المستخدم أو كلمة السر غير صحيحة.", CREDENTIALS_REQUIRED: "أدخل بريدك أو اسم المستخدم وكلمة السر.",
    EMAIL_INVALID: "أدخل بريداً إلكترونياً صحيحاً.", EMAIL_TAKEN: "هذا البريد مسجّل بالفعل. سجّل الدخول بدلاً من ذلك.",
    PASSWORD_WEAK: "استخدم 8 أحرف على الأقل لكلمة السر.", NAME_INVALID: "أدخل اسمك (حرفان على الأقل).",
    PHONE_INVALID: "أدخل رقم هاتف صحيحاً.", PHONE_TAKEN: "هذا الرقم مرتبط بحساب آخر.",
    BIRTHDATE_INVALID: "اختر تاريخ ميلاد صحيحاً.", OTP_INVALID: "الرمز غير صحيح.", OTP_EXPIRED: "انتهت صلاحية الرمز. اطلب رمزاً جديداً.",
    OTP_TOO_SOON: "انتظر دقيقة قبل طلب رمز آخر.", OTP_LIMIT: "تم طلب رموز كثيرة. حاول لاحقاً.",
    OTP_ATTEMPTS: "محاولات خاطئة كثيرة. اطلب رمزاً جديداً.", SMS_UNAVAILABLE: "الرسائل النصية غير متاحة حالياً.",
    SMS_FAILED: "تعذّر إرسال الرسالة. حاول مرة أخرى.", RESET_INVALID: "انتهت صلاحية الطلب. ابدأ من جديد.",
    GOOGLE_INVALID: "تعذّر على Google التحقق من حسابك.", GOOGLE_UNAVAILABLE: "تسجيل الدخول عبر Google غير متاح حالياً.",
    TOO_MANY_ATTEMPTS: "محاولات كثيرة. انتظر 15 دقيقة ثم حاول مجدداً.", AUTH_REQUIRED: "سجّل الدخول أولاً.",
    SERVER_ERROR: "حدث خطأ. حاول مرة أخرى.", NETWORK: "مشكلة في الشبكة. تحقق من اتصالك.",
  },
};

const fr: AuthCopy = {
  login: "Se connecter", signup: "S'inscrire", logout: "Se déconnecter", language: "Langue", account: "Compte", dashboard: "Tableau de bord",
  loginTitle: "Bon retour", signupTitle: "Créez votre compte", continueGoogle: "Continuer avec Google",
  continueEmail: "Continuer avec l'e-mail", orDivider: "ou", forgot: "Mot de passe oublié ?",
  noAccount: "Nouveau ? Inscrivez-vous", haveAccount: "Déjà inscrit ? Connectez-vous", close: "Fermer", back: "Retour",
  name: "Nom", email: "E-mail", emailOrUsername: "E-mail ou nom d'utilisateur", password: "Mot de passe", newPassword: "Nouveau mot de passe",
  phone: "Numéro de téléphone", phoneOptionalHint: "Nécessaire pour réinitialiser votre mot de passe par SMS", countryCode: "Indicatif",
  birthDate: "Date de naissance", submitLogin: "Se connecter", submitSignup: "Créer le compte",
  working: "Veuillez patienter…", forgotTitle: "Réinitialiser le mot de passe", forgotIntro: "Saisissez le numéro lié à votre compte. Nous vous enverrons un code à 6 chiffres par SMS.",
  sendCode: "Envoyer le code", codeTitle: "Saisissez le code", codeSentTo: p => `Nous avons envoyé un code à 6 chiffres au ${p}.`,
  verify: "Vérifier", resend: "Renvoyer le code", resendIn: s => `Renvoyer dans ${s} s`, skip: "Passer",
  newPasswordTitle: "Choisissez un nouveau mot de passe", savePassword: "Enregistrer", passwordChanged: "Mot de passe modifié. Connectez-vous avec le nouveau.",
  deviceTitle: "Vérifier cet appareil", deviceBody: p => `Pour votre sécurité, saisissez le code envoyé au ${p}. Cet appareil sera ensuite mémorisé.`,
  deviceTrusted: "Appareil approuvé.", phoneStepTitle: "Vérifiez votre téléphone", phoneStepBody: "Saisissez le code reçu par SMS pour pouvoir récupérer votre compte.",
  phoneVerified: "Téléphone vérifié.", devCode: "Code de test (SMS non configuré)", googleUnavailable: "La connexion Google est indisponible.",
  smsMock: "Fournisseur SMS non configuré : le code figure dans le journal du serveur.",
  errors: {
    INVALID_CREDENTIALS: "E-mail, nom d'utilisateur ou mot de passe incorrect.", CREDENTIALS_REQUIRED: "Saisissez votre e-mail ou nom d'utilisateur et votre mot de passe.",
    EMAIL_INVALID: "Saisissez une adresse e-mail valide.", EMAIL_TAKEN: "Cet e-mail est déjà inscrit. Connectez-vous.",
    PASSWORD_WEAK: "Le mot de passe doit contenir au moins 8 caractères.", NAME_INVALID: "Saisissez votre nom (2 caractères minimum).",
    PHONE_INVALID: "Saisissez un numéro valide.", PHONE_TAKEN: "Ce numéro est lié à un autre compte.",
    BIRTHDATE_INVALID: "Choisissez une date de naissance valide.", OTP_INVALID: "Code incorrect.", OTP_EXPIRED: "Code expiré. Demandez-en un nouveau.",
    OTP_TOO_SOON: "Attendez une minute avant de demander un autre code.", OTP_LIMIT: "Trop de codes demandés. Réessayez plus tard.",
    OTP_ATTEMPTS: "Trop d'essais. Demandez un nouveau code.", SMS_UNAVAILABLE: "Les SMS sont indisponibles pour le moment.",
    SMS_FAILED: "Envoi du SMS impossible. Réessayez.", RESET_INVALID: "Cette demande a expiré. Recommencez.",
    GOOGLE_INVALID: "Google n'a pas pu vérifier votre compte.", GOOGLE_UNAVAILABLE: "La connexion Google est indisponible.",
    TOO_MANY_ATTEMPTS: "Trop de tentatives. Attendez 15 minutes.", AUTH_REQUIRED: "Connectez-vous d'abord.",
    SERVER_ERROR: "Une erreur est survenue. Réessayez.", NETWORK: "Problème réseau. Vérifiez votre connexion.",
  },
};

const es: AuthCopy = {
  login: "Iniciar sesión", signup: "Registrarse", logout: "Cerrar sesión", language: "Idioma", account: "Cuenta", dashboard: "Panel",
  loginTitle: "Te damos la bienvenida", signupTitle: "Crea tu cuenta", continueGoogle: "Continuar con Google",
  continueEmail: "Continuar con correo", orDivider: "o", forgot: "¿Olvidaste tu contraseña?",
  noAccount: "¿Nuevo? Regístrate", haveAccount: "¿Ya tienes cuenta? Inicia sesión", close: "Cerrar", back: "Atrás",
  name: "Nombre", email: "Correo electrónico", emailOrUsername: "Correo o usuario", password: "Contraseña", newPassword: "Nueva contraseña",
  phone: "Número de teléfono", phoneOptionalHint: "Necesario para restablecer la contraseña por SMS", countryCode: "Prefijo",
  birthDate: "Fecha de nacimiento", submitLogin: "Iniciar sesión", submitSignup: "Crear cuenta",
  working: "Espera…", forgotTitle: "Restablecer contraseña", forgotIntro: "Introduce el teléfono de tu cuenta. Te enviaremos un código de 6 dígitos por SMS.",
  sendCode: "Enviar código", codeTitle: "Introduce el código", codeSentTo: p => `Enviamos un código de 6 dígitos a ${p}.`,
  verify: "Verificar", resend: "Reenviar código", resendIn: s => `Reenviar en ${s} s`, skip: "Omitir",
  newPasswordTitle: "Elige una nueva contraseña", savePassword: "Guardar", passwordChanged: "Contraseña cambiada. Inicia sesión con la nueva.",
  deviceTitle: "Verifica este dispositivo", deviceBody: p => `Por seguridad, introduce el código enviado a ${p}. Recordaremos este dispositivo.`,
  deviceTrusted: "Dispositivo de confianza.", phoneStepTitle: "Verifica tu teléfono", phoneStepBody: "Introduce el código recibido por SMS para poder recuperar tu cuenta.",
  phoneVerified: "Teléfono verificado.", devCode: "Código de prueba (SMS sin configurar)", googleUnavailable: "El acceso con Google no está disponible.",
  smsMock: "Proveedor de SMS sin configurar: el código aparece en el registro del servidor.",
  errors: {
    INVALID_CREDENTIALS: "Correo, usuario o contraseña incorrectos.", CREDENTIALS_REQUIRED: "Introduce tu correo o usuario y la contraseña.",
    EMAIL_INVALID: "Introduce un correo válido.", EMAIL_TAKEN: "Este correo ya está registrado. Inicia sesión.",
    PASSWORD_WEAK: "La contraseña necesita al menos 8 caracteres.", NAME_INVALID: "Introduce tu nombre (mínimo 2 caracteres).",
    PHONE_INVALID: "Introduce un teléfono válido.", PHONE_TAKEN: "Este teléfono está vinculado a otra cuenta.",
    BIRTHDATE_INVALID: "Elige una fecha de nacimiento válida.", OTP_INVALID: "Código incorrecto.", OTP_EXPIRED: "El código caducó. Pide uno nuevo.",
    OTP_TOO_SOON: "Espera un minuto antes de pedir otro código.", OTP_LIMIT: "Demasiados códigos solicitados. Inténtalo más tarde.",
    OTP_ATTEMPTS: "Demasiados intentos. Pide un código nuevo.", SMS_UNAVAILABLE: "Los SMS no están disponibles ahora.",
    SMS_FAILED: "No se pudo enviar el SMS. Inténtalo de nuevo.", RESET_INVALID: "Esta solicitud caducó. Empieza de nuevo.",
    GOOGLE_INVALID: "Google no pudo verificar tu cuenta.", GOOGLE_UNAVAILABLE: "El acceso con Google no está disponible.",
    TOO_MANY_ATTEMPTS: "Demasiados intentos. Espera 15 minutos.", AUTH_REQUIRED: "Inicia sesión primero.",
    SERVER_ERROR: "Algo salió mal. Inténtalo de nuevo.", NETWORK: "Problema de red. Revisa tu conexión.",
  },
};

const de: AuthCopy = {
  login: "Anmelden", signup: "Registrieren", logout: "Abmelden", language: "Sprache", account: "Konto", dashboard: "Dashboard",
  loginTitle: "Willkommen zurück", signupTitle: "Konto erstellen", continueGoogle: "Weiter mit Google",
  continueEmail: "Weiter mit E-Mail", orDivider: "oder", forgot: "Passwort vergessen?",
  noAccount: "Neu hier? Registrieren", haveAccount: "Schon registriert? Anmelden", close: "Schließen", back: "Zurück",
  name: "Name", email: "E-Mail", emailOrUsername: "E-Mail oder Benutzername", password: "Passwort", newPassword: "Neues Passwort",
  phone: "Telefonnummer", phoneOptionalHint: "Nötig, um das Passwort per SMS zurückzusetzen", countryCode: "Vorwahl",
  birthDate: "Geburtsdatum", submitLogin: "Anmelden", submitSignup: "Konto erstellen",
  working: "Bitte warten…", forgotTitle: "Passwort zurücksetzen", forgotIntro: "Gib die Telefonnummer deines Kontos ein. Wir senden dir einen 6-stelligen Code per SMS.",
  sendCode: "Code senden", codeTitle: "Code eingeben", codeSentTo: p => `Wir haben einen 6-stelligen Code an ${p} gesendet.`,
  verify: "Bestätigen", resend: "Code erneut senden", resendIn: s => `Erneut senden in ${s} s`, skip: "Überspringen",
  newPasswordTitle: "Neues Passwort wählen", savePassword: "Speichern", passwordChanged: "Passwort geändert. Melde dich mit dem neuen Passwort an.",
  deviceTitle: "Gerät bestätigen", deviceBody: p => `Gib zur Sicherheit den Code ein, den wir an ${p} gesendet haben. Danach merken wir uns dieses Gerät.`,
  deviceTrusted: "Gerät vertraut.", phoneStepTitle: "Telefon bestätigen", phoneStepBody: "Gib den per SMS erhaltenen Code ein, um dein Konto wiederherstellen zu können.",
  phoneVerified: "Telefon bestätigt.", devCode: "Testcode (SMS nicht eingerichtet)", googleUnavailable: "Google-Anmeldung ist derzeit nicht verfügbar.",
  smsMock: "SMS-Anbieter nicht eingerichtet: Der Code steht im Serverprotokoll.",
  errors: {
    INVALID_CREDENTIALS: "E-Mail, Benutzername oder Passwort ist falsch.", CREDENTIALS_REQUIRED: "Gib E-Mail oder Benutzername und Passwort ein.",
    EMAIL_INVALID: "Gib eine gültige E-Mail-Adresse ein.", EMAIL_TAKEN: "Diese E-Mail ist bereits registriert. Bitte anmelden.",
    PASSWORD_WEAK: "Das Passwort braucht mindestens 8 Zeichen.", NAME_INVALID: "Gib deinen Namen ein (mindestens 2 Zeichen).",
    PHONE_INVALID: "Gib eine gültige Telefonnummer ein.", PHONE_TAKEN: "Diese Nummer gehört zu einem anderen Konto.",
    BIRTHDATE_INVALID: "Wähle ein gültiges Geburtsdatum.", OTP_INVALID: "Der Code ist falsch.", OTP_EXPIRED: "Der Code ist abgelaufen. Fordere einen neuen an.",
    OTP_TOO_SOON: "Warte eine Minute, bevor du einen neuen Code anforderst.", OTP_LIMIT: "Zu viele Codes angefordert. Versuche es später.",
    OTP_ATTEMPTS: "Zu viele Fehlversuche. Fordere einen neuen Code an.", SMS_UNAVAILABLE: "SMS ist derzeit nicht verfügbar.",
    SMS_FAILED: "Die SMS konnte nicht gesendet werden. Versuche es erneut.", RESET_INVALID: "Diese Anfrage ist abgelaufen. Beginne neu.",
    GOOGLE_INVALID: "Google konnte dein Konto nicht bestätigen.", GOOGLE_UNAVAILABLE: "Google-Anmeldung ist derzeit nicht verfügbar.",
    TOO_MANY_ATTEMPTS: "Zu viele Versuche. Warte 15 Minuten.", AUTH_REQUIRED: "Bitte zuerst anmelden.",
    SERVER_ERROR: "Etwas ist schiefgelaufen. Versuche es erneut.", NETWORK: "Netzwerkproblem. Prüfe deine Verbindung.",
  },
};

const ALL: Record<Lang, AuthCopy> = { ar, en, fr, es, de };
export const authCopy = (lang: Lang): AuthCopy => ALL[lang] ?? en;
export function authErrorText(copy: AuthCopy, code: string | undefined): string {
  return copy.errors[code ?? ""] ?? copy.errors.SERVER_ERROR;
}
