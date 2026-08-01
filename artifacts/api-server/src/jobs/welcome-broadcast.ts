// ══════════════════════════════════════════════════════════════════
//  EMPIRE ETERNAL — WELCOME BROADCAST ENGINE v1.0
//  بث فوري لكل الشخصيات البارزة بمجرد تشغيل النظام
// ══════════════════════════════════════════════════════════════════

import { pool } from "@workspace/db";

// ── رسائل الترحيب القوية — تُختار عشوائياً لكل مواطن ──────────────
const WELCOME_MESSAGES: Array<{ title: string; body: string; icon: string }> = [
  {
    icon: "👑",
    title: "⚡ المملكة تستدعيك — EMPIRE ETERNAL",
    body: "أنت الآن جزء من الإمبراطورية الأكبر في تاريخ المحتوى الرقمي. استكشف الـ Legends، صوّت في GlobalStar، وشارك في Pulse — مكانك هنا يستحق أن يُرى.",
  },
  {
    icon: "🏛️",
    title: "🏛️ القوة الحقيقية تبدأ من هنا",
    body: "EMPIRE ETERNAL ليس مجرد موقع — إنه ميدان السيادة الرقمية. حقق إنجازاتك في الألعاب، ابنِ رصيدك في الشرف، وأصبح أسطورة يعرفها الجميع.",
  },
  {
    icon: "🔥",
    title: "🔥 الإمبراطورية تنتظر مواطناً مثلك",
    body: "الأبطال لا يُنتظرون — يتقدمون. زُر GlobalStar وصوّت لمن يستحق، أو أدخل الميدان في PLAY وأثبت من أنت. الأسطورة تبدأ الآن.",
  },
  {
    icon: "⚔️",
    title: "⚔️ مرحباً في عالم لا يُنسى",
    body: "من اللحظة التي قرأت فيها هذا، أنت لستَ زائراً — أنت مواطن في EMPIRE ETERNAL. اكتشف الـ Legends، واترك بصمتك في الـ Pulse، وابنِ إرثك من الصفر.",
  },
  {
    icon: "🌌",
    title: "🌌 الكون الرقمي فتح أبوابه",
    body: "EMPIRE ETERNAL — حيث يلتقي الرياضة والموسيقى والسينما والتراث في ميدان واحد. صوّتك يصنع التاريخ. مكانك محجوز بين الكبار.",
  },
  {
    icon: "🏆",
    title: "🏆 البطل لا يحتاج دعوة — هو يدخل",
    body: "منصة GDNA Arena جاهزة لك: Legends من كل الحضارات، GlobalStar لأفضل المواهب، ألعاب ومعارك وشرف. أين ستبدأ رحلتك؟",
  },
];

function pickMessage(userId: number) {
  return WELCOME_MESSAGES[userId % WELCOME_MESSAGES.length];
}

// ── إضافة عمود التتبع إذا لم يكن موجوداً ──────────────────────────
export async function ensureWelcomeBroadcastColumn() {
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS welcome_broadcast_sent boolean DEFAULT false
  `);
}

// ── دالة الإرسال الفعلي ──────────────────────────────────────────────
export async function runWelcomeBroadcast(options?: {
  minXp?: number;        // الحد الأدنى من XP — 0 يعني الكل
  limit?: number;        // عدد المستخدمين القصوى (0 = بلا حد)
  force?: boolean;       // أعد الإرسال حتى لمن أرسلنا له سابقاً
}): Promise<{ sent: number; skipped: number }> {
  const minXp  = options?.minXp  ?? 0;
  const limit  = options?.limit  ?? 0;
  const force  = options?.force  ?? false;

  const whereExtra = force ? "" : "AND welcome_broadcast_sent = false";
  const limitClause = limit > 0 ? `LIMIT ${limit}` : "";

  const { rows } = await pool.query<{ id: number; username: string }>(
    `SELECT id, username
     FROM users
     WHERE xp >= $1 ${whereExtra}
     ORDER BY (xp + honor_count * 10) DESC
     ${limitClause}`,
    [minXp]
  );

  let sent = 0;
  let skipped = 0;

  for (const user of rows) {
    try {
      const msg = pickMessage(user.id);

      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, icon, link_path)
         VALUES ($1, 'welcome_broadcast', $2, $3, $4, $5)`,
        [user.id, msg.title, msg.body, msg.icon, "/games"]
      );

      await pool.query(
        `UPDATE users SET welcome_broadcast_sent = true WHERE id = $1`,
        [user.id]
      );

      console.log(`[BROADCAST] 📨 Sent → ${user.username} (${msg.icon})`);
      sent++;
    } catch {
      skipped++;
    }
  }

  console.log(`[BROADCAST] ✅ Complete — ${sent} sent, ${skipped} skipped`);
  return { sent, skipped };
}

// ── تشغيل تلقائي عند إطلاق الخادم ─────────────────────────────────
export async function startWelcomeBroadcastJob() {
  try {
    await ensureWelcomeBroadcastColumn();
    console.log("[BROADCAST] 🌌 EMPIRE ETERNAL Broadcast Engine — ONLINE");

    // إرسال فوري بعد 8 ثواني من بدء الخادم
    setTimeout(async () => {
      const result = await runWelcomeBroadcast({ minXp: 0 });
      console.log(`[BROADCAST] 🏛️ Launch broadcast — ${result.sent} citizens notified`);
    }, 8_000);
  } catch (err) {
    console.warn("[BROADCAST] Engine startup error:", err);
  }
}
