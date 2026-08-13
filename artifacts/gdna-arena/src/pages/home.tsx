import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import RoyalPalace from "@/components/RoyalPalace";

interface LiveStats {
  users: number;
  posts: number;
  coinsCirculating: number;
  totalXp: number;
}

export default function ApexBanner() {
  const { t, lang, setLang } = useLang();
  const { user } = useAuth();
  const isRTL = lang === "ar";
  const [stats, setStats] = useState<LiveStats | null>(null);

  useEffect(() => {
    fetch("/api/pulse/stats", { credentials: "include" })
      .then((r) => r.json())
      .then((data: LiveStats) => setStats(data))
      .catch(() => {/* silently ignore — stats are decorative */});
  }, []);

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

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/games">
            <button
              className="royal-btn px-8 py-3 rounded-[10px] font-bold text-lg"
              style={{ background: "gold", color: "black", border: "none" }}
            >
              {t("apex_join")}
            </button>
          </Link>
          <Link href="/shop">
            <button
              className="px-8 py-3 rounded-[10px] font-bold text-lg text-yellow-400 bg-transparent"
              style={{ border: "2px solid #C9A84C" }}
            >
              {t("apex_shop")}
            </button>
          </Link>
        </div>

        <p style={{ color: "#aaa", fontSize: 14, marginTop: 14 }}>
          + استشارة مع الحاكم Ameeq بالصوت و 20 لغة
        </p>

        {/* Live stats */}
        <div className="flex items-center justify-center gap-8 mt-8">
          <div className="text-center">
            <p className="text-2xl sm:text-3xl font-black text-white">
              {stats ? stats.users.toLocaleString() : "—"}
            </p>
            <p className="text-yellow-400 text-xs sm:text-sm tracking-widest font-semibold uppercase mt-1">
              Citizens
            </p>
          </div>
          <div className="w-px h-10 bg-yellow-400/30" />
          <div className="text-center">
            <p className="text-2xl sm:text-3xl font-black text-white">
              {stats ? stats.posts.toLocaleString() : "—"}
            </p>
            <p className="text-yellow-400 text-xs sm:text-sm tracking-widest font-semibold uppercase mt-1">
              Voices
            </p>
          </div>
        </div>
      </div>
    </section>

    {/* ── Section cards: Arena / Shop / Missions ──────────────────── */}
    <section id="pillars" className="bg-black px-4 py-14 text-center" dir={isRTL ? "rtl" : "ltr"}>
      <p className="text-white/50 mb-10 text-lg">{t("apex_choose_path")}</p>
      <div className="max-w-[1000px] mx-auto flex flex-wrap justify-center gap-6">
        {[
          { href: "/games", title: t("apex_arena_card_title"), desc: t("apex_arena_card_desc"), cta: t("apex_arena_card_cta") },
          { href: "/shop",  title: t("apex_shop_card_title"),  desc: t("apex_shop_card_desc"),  cta: t("apex_shop_card_cta") },
          { href: "/growth",title: t("apex_tasks_card_title"), desc: t("apex_tasks_card_desc"), cta: t("apex_tasks_card_cta") },
        ].map((s) => (
          <Link key={s.href} href={s.href}>
            <div
              className="group rounded-[20px] p-8 w-[280px] text-center cursor-pointer transition-all duration-300 hover:scale-105"
              style={{ background: "#111", border: "2px solid #333" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "gold"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "#333"; }}
            >
              <h3 className="font-black text-2xl mb-3" style={{ color: "gold" }}>{s.title}</h3>
              <p className="text-white/80 text-sm">{s.desc}</p>
              <span
                className="block mt-4 py-3 rounded-[10px] font-bold text-white"
                style={{ background: "#C9A84C" }}
              >
                {s.cta}
              </span>
            </div>
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
