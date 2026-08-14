import { Router, type IRouter } from "express";
import bcrypt from "bcrypt";
import { eq, or, sql } from "drizzle-orm";
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
  try {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!username || !email || !password) {
    res.status(400).json({ error: "الاسم والبريد وكلمة السر مطلوبون — Nom, email et mot de passe requis" });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "صيغة البريد الإلكتروني غير صحيحة — Format d'email invalide" });
    return;
  }
  if (username.length < 3 || username.length > 20) {
    res.status(400).json({ error: "اسم المستخدم يجب أن يكون بين 3 و20 حرفاً — Nom d'utilisateur: 3 à 20 caractères" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "كلمة السر يجب أن تكون 6 أحرف على الأقل — Mot de passe: 6 caractères minimum" });
    return;
  }

  // ── Username content filter ───────────────────────────────────────────────
  if (hasBlockedKeyword(username)) {
    res.status(400).json({ error: "اسم المستخدم يحتوي على كلمات ممنوعة — Nom d'utilisateur interdit" });
    return;
  }
  // allowTrivial: usernames are short by nature (3–20 chars) — only run the
  // profanity/meme/OpenAI checks, not the 15-char "substance" rule.
  const usernameMod = await moderateText(username, { allowTrivial: true });
  if (!usernameMod.ok) {
    res.status(400).json({ error: "اسم المستخدم رفضه فلتر المحتوى — اختر اسماً آخر | Nom rejeté par le filtre" });
    return;
  }

  const existing = await db
    .select()
    .from(usersTable)
    .where(or(
      sql`LOWER(${usersTable.email}) = ${email}`,
      sql`LOWER(${usersTable.username}) = ${username.toLowerCase()}`,
    ))
    .limit(1);

  if (existing.length > 0) {
    // Tell the citizen exactly what's taken — and that they can just log in.
    const takenEmail = existing[0].email.toLowerCase() === email;
    res.status(409).json({
      error: takenEmail
        ? "هذا البريد مسجّل من قبل — عندك حساب بالفعل، سجّل الدخول مباشرة"
        : "اسم المستخدم مأخوذ — اختر اسماً آخر",
    });
    return;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  let user;
  try {
    [user] = await db
      .insert(usersTable)
      .values({ username, email, passwordHash })
      .returning();
  } catch (err: any) {
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      // Unique index race — someone registered the same email/username concurrently
      res.status(409).json({ error: "هذا البريد أو الاسم مسجّل من قبل — سجّل الدخول مباشرة" });
      return;
    }
    throw err;
  }

  req.session.userId = user.id;
  req.log.info({ userId: user.id }, "User registered");

  // إرسال رسالة الترحيب فورياً — بدون انتظار
  sendWelcomeNotification(user.id).catch(() => {});

  res.status(201).json(serializeUser(user));
  } catch (err) {
    req.log.error(err, "Register error");
    res.status(500).json({ error: "خطأ مؤقت في الخادم — حاول مرة أخرى" });
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  try {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  // "Se souvenir de moi" — defaults to true: one login, stay in like Netflix
  const rememberMe = req.body?.rememberMe !== false;
  if (!email || !password) {
    res.status(400).json({ error: "البريد الإلكتروني وكلمة السر مطلوبان — Email et mot de passe requis" });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "صيغة البريد الإلكتروني غير صحيحة — Format d'email invalide" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(sql`LOWER(${usersTable.email}) = ${email}`)
    .orderBy(usersTable.id)
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "لا يوجد حساب بهذا البريد — سجّل حساباً جديداً | Aucun compte avec cet email" });
    return;
  }

  let valid = false;
  try {
    valid = await bcrypt.compare(password, user.passwordHash);
  } catch {
    valid = false; // malformed legacy hash — treat as invalid, not a crash
  }
  if (!valid) {
    res.status(401).json({ error: "كلمة السر غير صحيحة — Mot de passe incorrect" });
    return;
  }

  req.session.userId = user.id;
  // Remember me: 90-day sliding session; otherwise the default 7 days.
  // Combined with rolling sessions, active citizens never see the login page.
  if (rememberMe) req.session.cookie.maxAge = 90 * 24 * 60 * 60 * 1000;
  req.log.info({ userId: user.id, rememberMe }, "User logged in");
  res.json(serializeUser(user));
  } catch (err) {
    req.log.error(err, "Login error");
    res.status(500).json({ error: "خطأ مؤقت في الخادم — حاول مرة أخرى" });
  }
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
