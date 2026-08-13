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
      <div dir="rtl" className="relative z-10 text-center px-4">
        {/* Arena label */}
        <h2 className="text-yellow-400 text-base sm:text-2xl tracking-[0.35em] sm:tracking-[0.5em] mb-4 sm:mb-6 font-semibold">
          GDNA ARENA — gdna.tv
        </h2>

        {/* Welcome heading */}
        <h1 className="hero-name text-3xl sm:text-5xl md:text-7xl font-black text-white mb-4 leading-tight break-words">
          مرحبا بك في{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600">
            GDNA Arena
          </span>{" "}
          👑
        </h1>

        {/* Tagline */}
        <p className="hero-sub text-yellow-400 text-sm sm:text-xl font-semibold mb-8 tracking-wide px-2">
          الساحة الرسمية لجمع XP والقطع والتنافس على لقب الإمبراطور
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/games"
            className="royal-btn inline-block px-8 py-3 rounded-[10px] font-bold text-lg"
            style={{ background: "gold", color: "black", border: "none" }}
          >
            ادخل الساحة الآن
          </Link>
          <Link
            href="/shop"
            className="inline-block px-8 py-3 rounded-[10px] font-bold text-lg text-yellow-400 bg-transparent"
            style={{ border: "2px solid #C9A84C" }}
          >
            تصفح المتجر
          </Link>
        </div>

        <p dir="rtl" style={{ color: "#aaa", fontSize: 14, marginTop: 14 }}>
          + استشارة مع الحاكم Ameeq بالصوت و 20 لغة
        </p>
      </div>
    </section>

    {/* ── الأقسام الثلاثة: الساحة / المتجر / المهام ─────────────── */}
    <section id="pillars" dir="rtl" className="bg-black px-4 py-14 text-center">
      <p className="text-white/50 mb-10 text-lg">الساحة الرسمية. اختر طريقك يا مواطن</p>
      <div className="max-w-[1000px] mx-auto flex flex-wrap justify-center gap-6">
        {[
          { href: "/games", title: "⚔️ الساحة", desc: "اجمع XP. تنافس. ارتقي من جندي لإمبراطور", cta: "ادخل الساحة" },
          { href: "/shop", title: "🛒 المتجر", desc: "اصرف القطع. اشتري الترقيات والأدوات النادرة", cta: "تصفح المتجر" },
          { href: "/growth", title: "🎯 المهام", desc: "انجز المهام اليومية واربح مكافآت ضخمة", cta: "ابدأ المهمة" },
        ].map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="block rounded-[20px] p-8 w-[280px] text-center bg-[#111] border-2 border-[#333] transition-all duration-300 hover:scale-105 hover:border-[gold]"
          >
            <h3 className="font-black text-2xl mb-3" style={{ color: "gold" }}>{s.title}</h3>
            <p className="text-white/80 text-sm">{s.desc}</p>
            <span
              className="block mt-4 py-3 rounded-[10px] font-bold text-white"
              style={{ background: "red" }}
            >
              {s.cta}
            </span>
          </Link>
        ))}
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
