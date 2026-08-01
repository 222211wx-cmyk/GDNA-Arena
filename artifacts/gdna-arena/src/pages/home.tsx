import { useEffect } from "react";
import { Link } from "wouter";
import { useLang } from "@/contexts/LangContext";

export default function ApexBanner() {
  const { t, lang, setLang } = useLang();
  const isRTL = lang === "ar";

  return (
    <section
      dir={isRTL ? "rtl" : "ltr"}
      className="relative w-full h-screen bg-black flex items-center justify-center overflow-hidden"
    >
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-black via-gray-900 to-black" />

      {/* Gold glow orb */}
      <div className="absolute w-[800px] h-[800px] bg-yellow-500/10 rounded-full blur-3xl" />

      {/* Content */}
      <div className="relative z-10 text-center px-4">
        {/* Arena label */}
        <h2 className="text-yellow-400 text-2xl tracking-[0.5em] mb-6 font-semibold">
          {t("apex_arena")}
        </h2>

        {/* Founder name */}
        <h1 className="text-6xl md:text-8xl font-black text-white mb-4 leading-tight">
          {t("apex_founder")}
          <span className="block text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600">
            {t("apex_surname")}
          </span>
        </h1>

        {/* Title */}
        <p className="text-yellow-400 text-xl font-semibold mb-8 tracking-wide">
          {t("apex_title")}
        </p>

        {/* CTA */}
        <Link href="/register">
          <button className="bg-yellow-500 text-black px-8 py-3 rounded-full font-bold text-lg hover:scale-105 hover:bg-yellow-400 transition-all shadow-[0_0_30px_rgba(255,215,0,0.3)]">
            {t("apex_join")}
          </button>
        </Link>
      </div>
    </section>
  );
}
