import { Router, type IRouter } from "express";
import bcrypt from "bcrypt";
import { eq, or } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { moderateText, hasBlockedKeyword } from "../lib/moderate";

// ── رسائل الترحيب — يتلقاها كل مواطن جديد فور تسجيله ─────────────
const WELCOME_POOL = [
  { icon: "👑", title: "⚡ المملكة تستدعيك — EMPIRE ETERNAL", body: "أنت الآن جزء من الإمبراطورية الأكبر في تاريخ المحتوى الرقمي. استكشف الـ Legends، صوّت في GlobalStar، وشارك في Pulse — مكانك هنا يستحق أن يُرى." },
  { icon: "🏛️", title: "🏛️ القوة الحقيقية تبدأ من هنا", body: "EMPIRE ETERNAL ليس مجرد موقع — إنه ميدان السيادة الرقمية. حقق إنجازاتك في الألعاب، ابنِ رصيدك في الشرف، وأصبح أسطورة يعرفها الجميع." },
  { icon: "🔥", title: "🔥 الإمبراطورية تنتظر مواطناً مثلك", body: "الأبطال لا يُنتظرون — يتقدمون. زُر GlobalStar وصوّت لمن يستحق، أو أدخل الميدان في PLAY وأثبت من أنت. الأسطورة تبدأ الآن." },
  { icon: "⚔️", title: "⚔️ مرحباً في عالم لا يُنسى", body: "من اللحظة التي قرأت فيها هذا، أنت لستَ زائراً — أنت مواطن في EMPIRE ETERNAL. اكتشف الـ Legends، واترك بصمتك في الـ Pulse، وابنِ إرثك من الصفر." },
  { icon: "🌌", title: "🌌 الكون الرقمي فتح أبوابه", body: "EMPIRE ETERNAL — حيث يلتقي الرياضة والموسيقى والسينما والتراث في ميدان واحد. صوّتك يصنع التاريخ. مكانك محجوز بين الكبار." },
  { icon: "🏆", title: "🏆 البطل لا يحتاج دعوة — هو يدخل", body: "منصة GDNA Arena جاهزة لك: Legends من كل الحضارات، GlobalStar لأفضل المواهب، ألعاب ومعارك وشرف. أين ستبدأ رحلتك؟" },
];

async function sendWelcomeNotification(userId: number) {
  try {
    const msg = WELCOME_POOL[userId % WELCOME_POOL.length];
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, icon, link_path)
       VALUES ($1, 'welcome_broadcast', $2, $3, $4, $5)`,
      [userId, msg.title, msg.body, msg.icon, "/games"]
    );
    await pool.query(
      `UPDATE users SET welcome_broadcast_sent = true WHERE id = $1`,
      [userId]
    );
  } catch { /* non-fatal */ }
}

const router: IRouter = Router();
const SALT_ROUNDS = 10;

declare module "express-session" {
  interface SessionData {
    userId: number;
  }
}

function canClaimDaily(lastDailyReward: Date | null): boolean {
  if (!lastDailyReward) return true;
  const now = new Date();
  const last = new Date(lastDailyReward);
  return (
    now.getUTCFullYear() !== last.getUTCFullYear() ||
    now.getUTCMonth() !== last.getUTCMonth() ||
    now.getUTCDate() !== last.getUTCDate()
  );
}

function serializeUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    balance: user.balance,
    xp: user.xp,
    gamesPlayed: user.gamesPlayed,
    wins: user.wins,
    canClaimDaily: canClaimDaily(user.lastDailyReward),
  };
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    res.status(400).json({ error: "Username, email, and password are required" });
    return;
  }
  if (username.length < 3 || username.length > 20) {
    res.status(400).json({ error: "Username must be 3–20 characters" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  // ── Username content filter ───────────────────────────────────────────────
  if (hasBlockedKeyword(username)) {
    res.status(400).json({ error: "Username contains prohibited content." });
    return;
  }
  const usernameMod = await moderateText(username);
  if (!usernameMod.ok) {
    res.status(400).json({ error: "Username rejected by content filter." });
    return;
  }

  const existing = await db
    .select()
    .from(usersTable)
    .where(or(eq(usersTable.email, email), eq(usersTable.username, username)))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "Email or username already taken" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const [user] = await db
    .insert(usersTable)
    .values({ username, email, passwordHash })
    .returning();

  req.session.userId = user.id;
  req.log.info({ userId: user.id }, "User registered");

  // إرسال رسالة الترحيب فورياً — بدون انتظار
  sendWelcomeNotification(user.id).catch(() => {});

  res.status(201).json(serializeUser(user));
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  req.session.userId = user.id;
  req.log.info({ userId: user.id }, "User logged in");
  res.json(serializeUser(user));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  req.session.destroy((err) => {
    if (err) logger.error(err, "Session destroy error");
  });
  res.json({ message: "Logged out" });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "User not found" });
    return;
  }

  res.json(serializeUser(user));
});

// ── DELETE /api/auth/me — GDPR right to erasure ───────────────
router.delete("/auth/me", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    // Anonymise all user content instead of hard-deleting rows
    // (preserves referential integrity while erasing PII)
    const anonymousName = `deleted_user_${userId}`;

    await pool.query(`
      UPDATE users
      SET username = $1, email = $2, password_hash = 'DELETED', bio = NULL,
          avatar = NULL, updated_at = NOW()
      WHERE id = $3
    `, [anonymousName, `${anonymousName}@deleted.gdna`, userId]);

    // Also wipe any stored legal consent rows
    await pool.query(
      `DELETE FROM user_legal_consents WHERE user_id = $1`, [userId]
    ).catch(() => {}); // table may not exist yet — ignore

    req.session.destroy(() => {});
    res.json({ message: "Account erased. All personal data has been deleted per GDPR Art. 17." });
  } catch (err) {
    logger.error(err, "GDPR erasure error");
    res.status(500).json({ error: "Erasure failed. Contact legal@gdna-arena.com." });
  }
});

export default router;
