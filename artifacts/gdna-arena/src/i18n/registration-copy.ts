import type { Lang } from "@/contexts/LangContext";

/**
 * Strings for the modern registration, code and channel screens.
 * One complete object per language, so a message never mixes languages.
 */
export interface RegistrationCopy {
  showPassword: string;
  hidePassword: string;
  confirmPassword: string;
  passwordMismatch: string;
  strength: [string, string, string, string];
  strengthLabel: string;
  emailInvalid: string;
  chooseChannelTitle: string;
  chooseChannelBody: string;
  channelSms: string;
  channelWhatsApp: string;
  channelEmail: string;
  codeTitle: string;
  codeBody: (target: string) => string;
  resend: string;
  resendIn: (s: number) => string;
  changeChannel: string;
  verifying: string;
  sending: string;
  rememberMe: string;
  continueGoogle: string;
  signupSuccess: string;
  signupCreate: string;
  noChannels: string;
  errorsExtra: Record<string, string>;
}

const en: RegistrationCopy = {
  showPassword: "Show password",
  hidePassword: "Hide password",
  confirmPassword: "Confirm password",
  passwordMismatch: "The passwords do not match.",
  strength: ["Too weak", "Weak", "Good", "Strong"],
  strengthLabel: "Password strength",
  emailInvalid: "Enter a valid email address, for example name@example.com.",
  chooseChannelTitle: "How do you want your code?",
  chooseChannelBody: "Pick one. You will choose again the next time a code is needed.",
  channelSms: "SMS",
  channelWhatsApp: "WhatsApp",
  channelEmail: "Email",
  codeTitle: "Enter your code",
  codeBody: t => `Enter the 6-digit code sent to ${t}.`,
  resend: "Resend code",
  resendIn: s => `Resend in ${s}s`,
  changeChannel: "Change channel",
  verifying: "Verifying…",
  sending: "Sending…",
  rememberMe: "Stay logged in",
  continueGoogle: "Continue with Google",
  signupSuccess: "Your account is ready.",
  signupCreate: "Create account",
  noChannels: "No code channel is available right now. Try again later.",
  errorsExtra: {
    CHANNEL_UNAVAILABLE: "This code channel is not available right now.",
    CHANNEL_INVALID: "Choose SMS, WhatsApp or Email.",
    OTP_TOO_SOON: "Please wait a moment before asking for another code.",
    OTP_LIMIT: "Too many codes were requested. Try again later.",
    DELIVERY_FAILED: "The code could not be delivered. Choose another channel.",
  },
};

const fr: RegistrationCopy = {
  showPassword: "Afficher le mot de passe",
  hidePassword: "Masquer le mot de passe",
  confirmPassword: "Confirmer le mot de passe",
  passwordMismatch: "Les mots de passe ne correspondent pas.",
  strength: ["Très faible", "Faible", "Bon", "Fort"],
  strengthLabel: "Force du mot de passe",
  emailInvalid: "Saisissez une adresse e-mail valide, par exemple nom@exemple.com.",
  chooseChannelTitle: "Comment voulez-vous recevoir votre code ?",
  chooseChannelBody: "Choisissez une option. Vous choisirez à nouveau la prochaine fois qu'un code sera nécessaire.",
  channelSms: "SMS",
  channelWhatsApp: "WhatsApp",
  channelEmail: "E-mail",
  codeTitle: "Saisissez votre code",
  codeBody: t => `Saisissez le code à 6 chiffres envoyé à ${t}.`,
  resend: "Renvoyer le code",
  resendIn: s => `Renvoyer dans ${s} s`,
  changeChannel: "Changer de canal",
  verifying: "Vérification…",
  sending: "Envoi…",
  rememberMe: "Rester connecté",
  continueGoogle: "Continuer avec Google",
  signupSuccess: "Votre compte est prêt.",
  signupCreate: "Créer le compte",
  noChannels: "Aucun canal de code n'est disponible pour le moment. Réessayez plus tard.",
  errorsExtra: {
    CHANNEL_UNAVAILABLE: "Ce canal de code n'est pas disponible pour le moment.",
    CHANNEL_INVALID: "Choisissez SMS, WhatsApp ou E-mail.",
    OTP_TOO_SOON: "Patientez un moment avant de demander un autre code.",
    OTP_LIMIT: "Trop de codes ont été demandés. Réessayez plus tard.",
    DELIVERY_FAILED: "Le code n'a pas pu être envoyé. Choisissez un autre canal.",
  },
};

const ar: RegistrationCopy = {
  showPassword: "إظهار كلمة المرور",
  hidePassword: "إخفاء كلمة المرور",
  confirmPassword: "تأكيد كلمة المرور",
  passwordMismatch: "كلمتا المرور غير متطابقتين.",
  strength: ["ضعيفة جدًا", "ضعيفة", "جيدة", "قوية"],
  strengthLabel: "قوة كلمة المرور",
  emailInvalid: "أدخل عنوان بريد إلكتروني صحيحًا، مثل name@example.com.",
  chooseChannelTitle: "كيف تريد استلام الرمز؟",
  chooseChannelBody: "اختر وسيلة واحدة. ستختار من جديد في كل مرة يلزم فيها رمز.",
  channelSms: "رسالة SMS",
  channelWhatsApp: "واتساب",
  channelEmail: "البريد الإلكتروني",
  codeTitle: "أدخل الرمز",
  codeBody: t => `أدخل الرمز المكوّن من 6 أرقام المرسل إلى ${t}.`,
  resend: "إعادة إرسال الرمز",
  resendIn: s => `إعادة الإرسال بعد ${s} ث`,
  changeChannel: "تغيير الوسيلة",
  verifying: "جارٍ التحقق…",
  sending: "جارٍ الإرسال…",
  rememberMe: "البقاء مسجّلًا الدخول",
  continueGoogle: "المتابعة باستخدام Google",
  signupSuccess: "حسابك جاهز.",
  signupCreate: "إنشاء الحساب",
  noChannels: "لا توجد وسيلة لإرسال الرمز حاليًا. حاول لاحقًا.",
  errorsExtra: {
    CHANNEL_UNAVAILABLE: "هذه الوسيلة غير متاحة حاليًا.",
    CHANNEL_INVALID: "اختر SMS أو واتساب أو البريد الإلكتروني.",
    OTP_TOO_SOON: "يرجى الانتظار قليلًا قبل طلب رمز آخر.",
    OTP_LIMIT: "تم طلب رموز كثيرة. حاول لاحقًا.",
    DELIVERY_FAILED: "تعذّر إرسال الرمز. اختر وسيلة أخرى.",
  },
};

const BY_LANG: Partial<Record<Lang, RegistrationCopy>> = { en, fr, ar };

/** Falls back to English for languages without a full set (es, de). */
export function registrationCopy(lang: Lang): RegistrationCopy {
  return BY_LANG[lang] ?? en;
}

/** Simple email check used before the request, so the error shows in the field. */
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** 0 to 4: length and character variety. */
export function passwordStrength(pw: string): number {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}
