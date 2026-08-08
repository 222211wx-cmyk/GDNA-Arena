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
        <h2 className="text-yellow-400 text-base sm:text-2xl tracking-[0.35em] sm:tracking-[0.5em] mb-4 sm:mb-6 font-semibold">
          {t("apex_arena")}
        </h2>

        {/* Founder name */}
        <h1 className="text-4xl sm:text-6xl md:text-8xl font-black text-white mb-4 leading-tight break-words">
          {t("apex_founder")}
          <span className="block text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600">
            {t("apex_surname")}
          </span>
        </h1>

        {/* Title */}
        <p className="text-yellow-400 text-sm sm:text-xl font-semibold mb-8 tracking-wide px-2">
          {t("apex_title")}
        </p>

        {/* CTA */}
        <Link href="/register">
          <button
            className="royal-btn px-8 py-3 rounded-[10px] font-bold text-lg"
            style={{ background: "gold", color: "black", border: "none" }}
          >
            {t("apex_join")}
          </button>
        </Link>

        <p dir="rtl" style={{ color: "#aaa", fontSize: 14, marginTop: 10 }}>
          + استشارة مع الحاكم Ameeq بالصوت و 20 لغة
        </p>
      </div>
    </section>
  );
}
