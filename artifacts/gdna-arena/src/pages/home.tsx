import { useEffect } from "react";
import { Link } from "wouter";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import RoyalPalace from "@/components/RoyalPalace";

export default function ApexBanner() {
  const { t, lang, setLang } = useLang();
  const { user } = useAuth();
  const isRTL = lang === "ar";

  return (
    <>
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
        <h1 className="hero-name text-4xl sm:text-6xl md:text-8xl font-black text-white mb-4 leading-tight break-words">
          {t("apex_founder")}
          <span className="block text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600">
            {t("apex_surname")}
          </span>
        </h1>

        {/* Title */}
        <p className="hero-sub text-yellow-400 text-sm sm:text-xl font-semibold mb-8 tracking-wide px-2">
          {t("apex_title")}
        </p>

        {/* CTA */}
        <button
          className="royal-btn px-8 py-3 rounded-[10px] font-bold text-lg"
          style={{ background: "gold", color: "black", border: "none" }}
          onClick={() => document.getElementById("palace")?.scrollIntoView({ behavior: "smooth" })}
        >
          {t("apex_join")}
        </button>

        <p dir="rtl" style={{ color: "#aaa", fontSize: 14, marginTop: 10 }}>
          + استشارة مع الحاكم Ameeq بالصوت و 20 لغة
        </p>
      </div>
    </section>

    {/* ── 🏛️ قصر المشاورات — على الصفحة الرئيسية ─────────────────── */}
    <section id="palace" className="bg-black px-4 pb-16">
      <div className="max-w-[600px] mx-auto">
        {user ? (
          <RoyalPalace />
        ) : (
          <div
            dir="rtl"
            className="rounded-[20px] p-8 mt-10 text-center"
            style={{ background: "#0f172a", border: "2px solid #25D366" }}
          >
            <h3 className="font-black text-lg md:text-xl mb-3" style={{ color: "#25D366" }}>
              🏛️ قصر استشارة الحاكم Ameeq
            </h3>
            <p className="text-white/70 text-sm mb-5">
              استشارة شخصية بالذكاء الاصطناعي — بالصوت وبلغتك. سجّل كمواطن باش تدخل للقصر.
            </p>
            <Link href="/register">
              <button
                className="royal-btn px-8 py-3 rounded-[50px] font-bold"
                style={{ background: "gold", color: "black", border: "none" }}
              >
                {t("apex_join")}
              </button>
            </Link>
          </div>
        )}
      </div>
    </section>
    </>
  );
}
