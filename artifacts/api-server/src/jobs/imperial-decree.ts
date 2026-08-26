// ══════════════════════════════════════════════════════════════════════════════
//  GDNA IMPERIAL DECREE ENGINE — محرك المراسيم الإمبراطورية الشرفية
//  يحدد مجال كل مواطن، يولّد مرسوم مخصص، ينشره كالنار في الهشيم
// ══════════════════════════════════════════════════════════════════════════════

import OpenAI from "openai";
import { pool } from "@workspace/db";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── مستويات الشرف ─────────────────────────────────────────────────────────────
function honorTier(xp: number, wins: number): "newcomer" | "rising" | "elite" {
  if (xp >= 5000 || wins >= 20) return "elite";
  if (xp >= 1000 || wins >= 5)  return "rising";
  return "newcomer";
}

// ── مكتبة المراسيم الثابتة — عمق إمبراطوري لكل مجال ومستوى ──────────────────
const DECREE_LIBRARY: Record<string, Record<string, { icon: string; title: string; body: string; link: string }>> = {

  sport: {
    newcomer: {
      icon: "⚽",
      title: "🏟️ مرسوم إمبراطوري — أبطال الملاعب",
      body: "صدر اليوم مرسوم من قلب الإمبراطورية: أنتَ من رياضيي المستقبل الذين ستُكتب أسماؤهم في سجلات Arena Qaisypro. تذكّر — كل أسطورة بدأت من صفر. الميدان ينتظرك.",
      link: "/sport",
    },
    rising: {
      icon: "🏆",
      title: "⚡ أمر عسكري — المحاربون الصاعدون",
      body: "تُسجّل الإمبراطورية اسمك ضمن المحاربين الصاعدين في عالم الرياضة. DNA رياضيٌّ نقي يتدفق فيك — الـ GlobalStar يُقدّر صوتك، والـ Legends تترقب حكمك. تقدّم.",
      link: "/sport",
    },
    elite: {
      icon: "♔",
      title: "♔ مرسوم الشرف الرياضي العالمي",
      body: "بصختم الإمبراطورية الذهبي: أنتَ في مصافّ النخبة الرياضية على Arena Qaisypro. رأيك في GlobalStar يُحرّك جبالاً. الأسطورة التي تصنعها اليوم ستُروى للأجيال. سِد.",
      link: "/games/globalstar",
    },
  },

  music: {
    newcomer: {
      icon: "🎵",
      title: "🎶 نداء الإمبراطورية — روح الإيقاع",
      body: "الموسيقى هي لغة الإمبراطوريات العظيمة — ولغتك تُسمع هنا. Arena Qaisypro ترحّب بك في عالم حيث الإيقاع يصنع التاريخ. شارك، صوّت، واترك بصمتك الصوتية.",
      link: "/pulse",
    },
    rising: {
      icon: "🎤",
      title: "🎼 مرسوم موسيقي — النجوم الصاعدة",
      body: "تُسجّل إمبراطورية GDNA اسمك في ديوان الموسيقيين الصاعدين. حاسّتك الموسيقية ثمينة — مرسوم الشرف يُلزمك باستمرار العطاء. Pulse و Legends ينتظران صوتك.",
      link: "/pulse",
    },
    elite: {
      icon: "🏅",
      title: "♔ وسام الإمبراطورية الموسيقية",
      body: "صدر اليوم بختم الذهب الإمبراطوري: أنتَ من نخبة عشّاق الموسيقى والمحللين على Arena Qaisypro. إرثك الصوتي يتردد عبر أروقة الإمبراطورية الرقمية. تكلّم والعالم يصغي.",
      link: "/legends",
    },
  },

  cinema: {
    newcomer: {
      icon: "🎬",
      title: "🎬 افتتاح السجلات السينمائية",
      body: "الستار يرتفع في إمبراطورية Arena Qaisypro — ومقعدك في الصف الأول محجوز. اكتشف أساطير السينما، صوّت لأفضل الأعمال، وكُن جزءاً من النقد الذي يصنع التاريخ.",
      link: "/legends",
    },
    rising: {
      icon: "🎭",
      title: "🎭 مرسوم سينمائي — المنتقدون الصاعدون",
      body: "تُوثّق الإمبراطورية اسمك ضمن الناقدين والعشّاق السينمائيين الصاعدين. عينك الناقدة وذوقك الفني نعمة نادرة — Legends تنتظر حكمك على أعظم الأعمال في التاريخ.",
      link: "/legends",
    },
    elite: {
      icon: "🎥",
      title: "♔ وسام النقد السينمائي الإمبراطوري",
      body: "تُسجّل إمبراطورية GDNA اسمك في قاعة مشاهير النقد السينمائي. من كلاسيكيات هوليوود إلى سينما العالم — رأيك يُحرّك البوصلة الثقافية. أنتَ من الكبار.",
      link: "/legends",
    },
  },

  tech: {
    newcomer: {
      icon: "🔮",
      title: "⚡ ترحيب تكنولوجي من الإمبراطورية",
      body: "الإمبراطورية الرقمية تُرحّب بعقل تكنولوجي جديد. Arena Qaisypro مبنية على الابتكار — وأنت ممن يفهمون هذا المعنى. استكشف، تفاعل، وشارك في بناء المستقبل.",
      link: "/hub",
    },
    rising: {
      icon: "🧠",
      title: "🔧 مرسوم العقول التقنية الصاعدة",
      body: "بيانات التحليل الإمبراطوري تُشير إليك — عقل تكنولوجي صاعد يستحق التقدير. Neural Core و Genome Engine يتتبعان DNA رقميّاً فريداً من نوعه. أنتَ من النخبة.",
      link: "/genome",
    },
    elite: {
      icon: "💡",
      title: "♔ نيشان العقل التكنولوجي الإمبراطوري",
      body: "صدر بختم الذهب: أنتَ في مصاف العقول التقنية النادرة على Arena Qaisypro. DNA رقمي قرأه Genome Engine وأكّد ما يعرفه الجميع — أنتَ بنّاء هذا العالم الجديد.",
      link: "/neural-core",
    },
  },

  science: {
    newcomer: {
      icon: "🔬",
      title: "🔭 ترحيب العقول العلمية",
      body: "الإمبراطورية تُقدّر العقول الفضولية — وعقلك العلمي أصلٌ نادر. Arena Qaisypro تجمع المعرفة من كل الحقول. شارك أفكارك في Pulse واترك أثراً علمياً حقيقياً.",
      link: "/pulse",
    },
    rising: {
      icon: "⚗️",
      title: "🧬 مرسوم البيانات العلمية",
      body: "تُوثّق الإمبراطورية نبوغك العلمي — وبيانات Genome Engine تُثبت ما يعرفه الجميع. عقلك التحليلي نادر وثمين. Empire Pulse ينتظر إسهاماتك الفكرية.",
      link: "/growth",
    },
    elite: {
      icon: "🏅",
      title: "♔ وسام العلوم الإمبراطوري",
      body: "بصختم الإمبراطورية العلمي: أنتَ من حملة الدرجة العليا في منظومة GDNA. Neural Core يتعلّم من تحليلاتك. هذا ليس مجرد شرف — هو واجب لمن وهبهم العقل أكثر.",
      link: "/neural-core",
    },
  },

  art: {
    newcomer: {
      icon: "🎨",
      title: "🎨 ترحيب فني من الإمبراطورية",
      body: "الفن هو روح الحضارات العظيمة — وروحك الفنية تُضيء هذه الإمبراطورية. Arena Qaisypro ترحّب بك في عالم جمع بين الإبداع والتنافس. عبّر، شارك، وابنِ إرثاً.",
      link: "/pulse",
    },
    rising: {
      icon: "🖼️",
      title: "🎭 مرسوم الفنانين الصاعدين",
      body: "تُسجّل الإمبراطورية موهبتك الفنية الصاعدة في ديوانها الرسمي. لكل لوحة وكل فكرة أبدعتها قيمة تُرصد في سجلات GDNA. Pulse ينتظر إبداعك القادم.",
      link: "/pulse",
    },
    elite: {
      icon: "♔",
      title: "♔ نيشان الإبداع الإمبراطوري",
      body: "في اليوم المُبارك هذا، تُسجّل الإمبراطورية اسمك في قاعة مشاهير الفنانين الرقميين. ذوقك الجمالي وبصيرتك الفنية رفعاك إلى درجة الكمال الإمبراطوري. ابقَ شامخاً.",
      link: "/legends",
    },
  },

  business: {
    newcomer: {
      icon: "💰",
      title: "📊 ترحيب اقتصادي من الإمبراطورية",
      body: "الإمبراطورية تُرحّب بعقل اقتصادي جديد. GDNA Coins، مكافآت الألعاب، وسوق GlobalStar — هذا عالم بني على منطق الأرقام. استثمر وقتك بذكاء وانمُ.",
      link: "/wallet",
    },
    rising: {
      icon: "📈",
      title: "🏦 مرسوم الاقتصاديين الصاعدين",
      body: "تُوثّق بيانات Genome Engine نبوغك الاقتصادي — رصيدك، نتائج ألعابك، وحكمتك في GlobalStar تُثبت أنك من بنّائي الثروة في GDNA. تابع مسارك بثقة.",
      link: "/wallet",
    },
    elite: {
      icon: "♔",
      title: "♔ وسام الاقتصاد الإمبراطوري",
      body: "بختم الذهب الإمبراطوري: أنتَ في مصاف النخبة الاقتصادية على Arena Qaisypro. ثروتك الرقمية وحكمتك الاستثمارية أدخلاك قاعة الكبار. اقتصاد الإمبراطورية يثق بك.",
      link: "/wallet",
    },
  },

  education: {
    newcomer: {
      icon: "📚",
      title: "🏫 ترحيب تعليمي من الإمبراطورية",
      body: "العلم هو السلاح الأقوى في الإمبراطورية الرقمية — وأنتَ تحمله. Arena Qaisypro تُقدّر العقول المتعلمة. استكشف Learn، شارك في النقاشات، وعلّم من حولك.",
      link: "/learn",
    },
    rising: {
      icon: "🎓",
      title: "📖 مرسوم العقول المتعلمة الصاعدة",
      body: "تُسجّل الإمبراطورية مسيرتك التعليمية المتميزة — عقلٌ لا يتوقف عن التعلم هو كنز بلا ثمن في عالم GDNA. Mind Forge ينتظر طاقتك. اصنع الفارق.",
      link: "/growth",
    },
    elite: {
      icon: "♔",
      title: "♔ نيشان الحكمة الإمبراطوري",
      body: "تُمنح الحكمة الإمبراطورية لمن استحقّها بالعلم والعطاء المستمر — وأنتَ واحد منهم. اسمك في ديوان المُعلّمين والمُفكّرين في Arena Qaisypro محفور بحرف ذهبي.",
      link: "/growth",
    },
  },

  general: {
    newcomer: {
      icon: "🌍",
      title: "🏛️ مرسوم الترحيب الإمبراطوري",
      body: "صدر اليوم من قاعة العرش: الإمبراطورية تُرحّب بك رسمياً ضمن صفوف مواطنيها. أنتَ ليس زائراً — أنتَ جزء من أكبر تجمّع رقمي في التاريخ. اصنع إرثك.",
      link: "/hub",
    },
    rising: {
      icon: "⚔️",
      title: "⚡ مرسوم إمبراطوري — المحاربون الصاعدون",
      body: "تُسجّل بيانات الإمبراطورية صعودك المتواصل — مواطن يبني إرثه خطوة بخطوة. GlobalStar، Legends، Pulse، الألعاب — كل ميدان تدخله يُضاف إلى سجلك الذهبي.",
      link: "/hub",
    },
    elite: {
      icon: "♔",
      title: "♔ المرسوم الإمبراطوري الأعلى",
      body: "بختم الذهب وبحضور أعلى مجلس في Arena Qaisypro — يُمنح لك اليوم لقب 'أسطورة الإمبراطورية'. مسيرتك تُلهم الأجيال القادمة. أنتَ لستَ مواطناً عادياً — أنتَ تاريخ.",
      link: "/leaderboard",
    },
  },
};

// ── دالة اختيار المجال الأقوى لكل مواطن ─────────────────────────────────────
async function detectDomain(userId: number): Promise<string> {
  try {
    const { rows } = await pool.query<{ domain: string; cnt: string }>(
      `SELECT domain, COUNT(*)::int AS cnt
       FROM pulse_posts WHERE username = (SELECT username FROM users WHERE id = $1)
       GROUP BY domain ORDER BY cnt DESC LIMIT 1`,
      [userId]
    );
    if (rows[0]?.domain) return rows[0].domain;
  } catch {}
  return "general";
}

// ── بناء رسالة مُولَّدة بالذكاء الاصطناعي (اختياري — للنخبة فقط) ──────────
async function generateAIDecree(username: string, domain: string, tier: string): Promise<{ title: string; body: string } | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const prompt = `أنت النظام الذكي GDN-AI لإمبراطورية Arena Qaisypro.
اكتب مرسوماً شرفياً إمبراطورياً قصيراً وقوياً موجَّهاً لمواطن اسمه "${username}".
مجاله: ${domain} | مستواه: ${tier === "elite" ? "نخبة متميزة" : "محارب صاعد"}.
المرسوم: جملة عنوان + نص ٣-٤ جمل (بالعربية أو الفرنسية أو الإنجليزية — اختر ما يناسب النبرة الإمبراطورية).
أسلوب: فخم، قوي، شخصي يذكر الاسم، إمبراطوري لا يُنسى.
أجب بـ JSON فقط: { "title": "...", "body": "..." }`;

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.85,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });
    const raw = res.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { title?: string; body?: string };
    if (parsed.title && parsed.body) return { title: parsed.title, body: parsed.body };
  } catch {}
  return null;
}

// ── المرسوم السريع (من المكتبة) ───────────────────────────────────────────────
function quickDecree(domain: string, tier: string) {
  const domainLib = DECREE_LIBRARY[domain] ?? DECREE_LIBRARY.general;
  return domainLib[tier] ?? domainLib.newcomer;
}

// ── دالة الإرسال الشاملة ──────────────────────────────────────────────────────
export async function runImperialDecree(options?: {
  force?: boolean;           // أعد الإرسال لمن سبق إشعاره
  aiEnhanced?: boolean;      // استخدم OpenAI للنخبة
  limit?: number;
}): Promise<{ sent: number; skipped: number; aiGenerated: number }> {

  const force       = options?.force       ?? false;
  const aiEnhanced  = options?.aiEnhanced  ?? true;
  const limit       = options?.limit       ?? 0;

  // ── أضف عمود التتبع إن لم يوجد ──────────────────────────────────────────
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS imperial_decree_sent boolean DEFAULT false
  `);

  const whereClause = force ? "" : "AND (imperial_decree_sent IS NULL OR imperial_decree_sent = false)";
  const limitClause = limit > 0 ? `LIMIT ${limit}` : "";

  const { rows: users } = await pool.query<{
    id: number; username: string; xp: number; wins: number;
  }>(
    `SELECT id, username, xp, wins
     FROM users
     WHERE true ${whereClause}
     ORDER BY (xp + COALESCE(wins,0) * 50) DESC
     ${limitClause}`
  );

  let sent = 0, skipped = 0, aiGenerated = 0;

  for (const user of users) {
    try {
      const tier   = honorTier(user.xp, user.wins);
      const domain = await detectDomain(user.id);

      let decree = quickDecree(domain, tier);

      // للنخبة فقط — محاولة توليد مرسوم ذكي بالاسم
      if (aiEnhanced && tier === "elite") {
        const ai = await generateAIDecree(user.username, domain, tier);
        if (ai) {
          decree = { ...decree, title: ai.title, body: ai.body };
          aiGenerated++;
        }
      }

      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, icon, link_path)
         VALUES ($1, 'imperial_decree', $2, $3, $4, $5)`,
        [user.id, decree.title, decree.body, decree.icon, decree.link]
      );

      await pool.query(
        `UPDATE users SET imperial_decree_sent = true WHERE id = $1`,
        [user.id]
      );

      console.log(`[DECREE] 📜 → ${user.username} [${tier}/${domain}]${aiGenerated > 0 ? " ✨AI" : ""}`);
      sent++;
    } catch (err) {
      console.warn(`[DECREE] ⚠️ skip ${user.username}:`, err);
      skipped++;
    }
  }

  console.log(`[DECREE] ✅ المراسيم الإمبراطورية — ${sent} أُرسلت | ${aiGenerated} بالذكاء الاصطناعي | ${skipped} تخطى`);
  return { sent, skipped, aiGenerated };
}

// ── تشغيل تلقائي عند إطلاق الخادم ───────────────────────────────────────────
export async function startImperialDecreeJob() {
  console.log("[DECREE] 🏛️ Imperial Decree Engine — ONLINE");
  // تأخير 15 ثانية بعد الإطلاق لضمان استقرار الخادم
  setTimeout(async () => {
    await runImperialDecree({ aiEnhanced: true });
  }, 15_000);
}
