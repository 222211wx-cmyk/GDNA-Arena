/**
 * AGE GATE
 * Full-screen overlay for countries that require age verification.
 * BYPASSED on /login, /register, /legal — visitors must always be
 * able to register or log in even before completing age check.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { useLegal } from "@/contexts/LegalContext";
import { useLang } from "@/contexts/LangContext";

// Paths that should never be blocked by the age gate
const FREE_PATHS = ["/login", "/register", "/legal"];

export default function AgeGate() {
  const { country, ageVerified, setAgeVerified } = useLegal();
  const { lang } = useLang();
  const [location] = useLocation();
  const [denied, setDenied] = useState(false);
  const isRTL = lang === "ar";

  // Never block login / register / legal
  const isFree = FREE_PATHS.some(p => location === p || location.startsWith(p + "/"));
  if (isFree) return null;

  // Only show if country requires it and user hasn't verified yet
  if (!country.ageGateRequired || ageVerified) return null;

  const T = {
    title:  {
      en: `Age Verification Required`,
      ar: `التحقق من العمر مطلوب`,
      fr: `Vérification d'âge requise`,
      es: `Verificación de edad requerida`,
      de: `Altersverifizierung erforderlich`,
    },
    body:   {
      en: `This platform requires users to be at least ${country.minAge} years old in ${country.name} (${country.laws[0]}).`,
      ar: `تشترط هذه المنصة أن يكون المستخدم بعمر ${country.minAge} سنة على الأقل في ${country.name} (${country.laws[0]}).`,
      fr: `Cette plateforme exige que les utilisateurs aient au moins ${country.minAge} ans en ${country.name} (${country.laws[0]}).`,
      es: `Esta plataforma requiere que los usuarios tengan al menos ${country.minAge} años en ${country.name} (${country.laws[0]}).`,
      de: `Diese Plattform erfordert ein Mindestalter von ${country.minAge} Jahren in ${country.name} (${country.laws[0]}).`,
    },
    yes:    {
      en: `I am ${country.minAge}+ years old`,
      ar: `عمري ${country.minAge} سنة أو أكثر`,
      fr: `J'ai ${country.minAge} ans ou plus`,
      es: `Tengo ${country.minAge} años o más`,
      de: `Ich bin ${country.minAge}+ Jahre alt`,
    },
    no:     {
      en: `I am under ${country.minAge}`,
      ar: `عمري أقل من ${country.minAge}`,
      fr: `J'ai moins de ${country.minAge} ans`,
      es: `Tengo menos de ${country.minAge} años`,
      de: `Ich bin unter ${country.minAge}`,
    },
    denied: {
      en: `Access restricted. This platform is not available for users under ${country.minAge} in ${country.name}.`,
      ar: `الوصول مقيّد. هذه المنصة غير متاحة لمن هم دون ${country.minAge} سنة في ${country.name}.`,
      fr: `Accès restreint. Cette plateforme n'est pas disponible pour les moins de ${country.minAge} ans en ${country.name}.`,
      es: `Acceso restringido. Esta plataforma no está disponible para menores de ${country.minAge} años en ${country.name}.`,
      de: `Zugang eingeschränkt. Diese Plattform ist für Nutzer unter ${country.minAge} Jahren in ${country.name} nicht verfügbar.`,
    },
    loginHint: {
      en: `Already have an account?`,
      ar: `هل لديك حساب بالفعل؟`,
      fr: `Vous avez déjà un compte ?`,
      es: `¿Ya tienes una cuenta?`,
      de: `Haben Sie bereits ein Konto?`,
    },
    loginLink: {
      en: `Log in`,
      ar: `تسجيل الدخول`,
      fr: `Se connecter`,
      es: `Iniciar sesión`,
      de: `Anmelden`,
    },
    registerHint: {
      en: `New here?`,
      ar: `جديد هنا؟`,
      fr: `Nouveau ici ?`,
      es: `¿Nuevo aquí?`,
      de: `Neu hier?`,
    },
    registerLink: {
      en: `Create account`,
      ar: `إنشاء حساب`,
      fr: `Créer un compte`,
      es: `Crear cuenta`,
      de: `Konto erstellen`,
    },
  };

  const t = (k: keyof typeof T): string =>
    (T[k] as Record<string, string>)[lang] ?? (T[k] as Record<string, string>)["en"];

  return (
    <div
      dir={isRTL ? "rtl" : "ltr"}
      className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex items-center justify-center px-4"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="max-w-md w-full border border-yellow-500/30 rounded-2xl bg-gray-950 p-8 text-center"
      >
        <div className="text-5xl mb-4">{country.flag}</div>
        <h2 className="text-white font-black text-2xl mb-3">{t("title")}</h2>

        {denied ? (
          <p className="text-red-400 text-sm leading-relaxed mt-4">{t("denied")}</p>
        ) : (
          <>
            <p className="text-gray-400 text-sm leading-relaxed mb-6">{t("body")}</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setAgeVerified(true)}
                className="w-full bg-yellow-500 text-black font-bold py-3 rounded-xl hover:bg-yellow-400 transition-all"
              >
                {t("yes")}
              </button>
              <button
                onClick={() => setDenied(true)}
                className="w-full border border-gray-700 text-gray-400 font-semibold py-3 rounded-xl hover:border-gray-500 transition-all"
              >
                {t("no")}
              </button>
            </div>

            {/* Auth shortcuts — always accessible below the gate */}
            <div className="mt-6 pt-5 border-t border-gray-800 flex items-center justify-center gap-4 text-xs">
              <span className="text-gray-600">{t("loginHint")}</span>
              <a href="/login"    className="text-yellow-400 hover:text-yellow-300 font-semibold underline transition-colors">{t("loginLink")}</a>
              <span className="text-gray-700">·</span>
              <a href="/register" className="text-yellow-400 hover:text-yellow-300 font-semibold underline transition-colors">{t("registerLink")}</a>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
