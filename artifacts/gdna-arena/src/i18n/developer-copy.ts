import type { Lang } from "@/contexts/LangContext";

/** Developer registration + Developer particle copy. One complete set per language; unknown languages fall back to English. */
export interface DeveloperCopy {
  cta: string; title: string; intro: string; username: string; submit: string; codeIntro: (phone: string) => string;
  particleHead: string; particleName: string; particleSub: string;
  errors: Record<string, string>;
}

const en: DeveloperCopy = {
  cta: "Developer registration", title: "Developer registration",
  intro: "Create a developer account. We text a 6-digit code to your phone; your account is created once you verify it.",
  username: "Username", submit: "Send code", codeIntro: p => `Enter the 6-digit code we sent to ${p}.`,
  particleHead: "Developer particle", particleName: "FABRICA", particleSub: "Power to build",
  errors: { USERNAME_INVALID: "Username: 3–20 letters, digits or underscores.", USERNAME_TAKEN: "This username is already taken.", SMS_UNAVAILABLE: "SMS delivery is not configured yet, so developer sign-up is unavailable right now." },
};
const ar: DeveloperCopy = {
  cta: "التسجيل المطور", title: "التسجيل المطور",
  intro: "أنشئ حساب مطور. سنرسل رمزاً من 6 أرقام إلى هاتفك، ويُنشأ حسابك بعد التحقق منه.",
  username: "اسم المستخدم", submit: "إرسال الرمز", codeIntro: p => `أدخل الرمز المكوّن من 6 أرقام المرسل إلى ${p}.`,
  particleHead: "جسيم المطور", particleName: "FABRICA", particleSub: "قوة البناء",
  errors: { USERNAME_INVALID: "اسم المستخدم: من 3 إلى 20 حرفاً أو رقماً أو شرطة سفلية.", USERNAME_TAKEN: "اسم المستخدم مستخدم بالفعل.", SMS_UNAVAILABLE: "إرسال الرسائل النصية غير مُفعّل بعد، لذا التسجيل المطور غير متاح الآن." },
};
const fr: DeveloperCopy = {
  cta: "Inscription développeur", title: "Inscription développeur",
  intro: "Créez un compte développeur. Un code à 6 chiffres est envoyé par SMS ; le compte est créé après vérification.",
  username: "Nom d'utilisateur", submit: "Envoyer le code", codeIntro: p => `Saisissez le code à 6 chiffres envoyé au ${p}.`,
  particleHead: "Particule développeur", particleName: "FABRICA", particleSub: "Puissance de construction",
  errors: { USERNAME_INVALID: "Nom d'utilisateur : 3 à 20 lettres, chiffres ou tirets bas.", USERNAME_TAKEN: "Ce nom d'utilisateur est déjà pris.", SMS_UNAVAILABLE: "L'envoi de SMS n'est pas encore configuré : l'inscription développeur est indisponible pour le moment." },
};

export function developerCopy(lang: Lang): DeveloperCopy {
  return lang === "ar" ? ar : lang === "fr" ? fr : en;
}
