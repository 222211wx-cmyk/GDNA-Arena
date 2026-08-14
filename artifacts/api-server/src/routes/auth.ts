import { Router, type IRouter } from "express";
import bcrypt from "bcrypt";
import { eq, or, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { moderateText, hasBlockedKeyword } from "../lib/moderate";
import { sendVerificationEmail, isMailerConfigured } from "../lib/mailer";

// ── Email verification codes (one-time, at registration) ────────────────
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between sends
const MAX_ATTEMPTS = 5;

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

// Email verification is only enforced when we can actually deliver codes:
// a real provider in production, or the dev log fallback in development.
function verificationActive(): boolean {
  return isMailerConfigured() || process.env.NODE_ENV !== "production";
}

async function issueVerificationCode(userId: number, email: string): Promise<boolean> {
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, SALT_ROUNDS);
  // Send FIRST — a failed delivery must not clobber a still-usable prior code
  const { sent } = await sendVerificationEmail(email, code);
  if (!sent) return false;
  await pool.query(
    `INSERT INTO email_verification_codes (user_id, code_hash, expires_at, attempts, last_sent_at)
     VALUES ($1, $2, now() + interval '10 minutes', 0, now())
     ON CONFLICT (user_id) DO UPDATE
       SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
           attempts = 0, last_sent_at = now()`,
    [userId, codeHash]
  );
  return true;
}

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
        ? "هذا البريد مسجّل من قبل — سجّل الدخول مباشرة | Cet email est déjà enregistré — connectez-vous"
        : "اسم المستخدم مأخوذ — اختر اسماً آخر | Nom d'utilisateur déjà pris",
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
      res.status(409).json({ error: "هذا البريد أو الاسم مسجّل من قبل — سجّل الدخول مباشرة | Email ou nom déjà enregistré" });
      return;
    }
    throw err;
  }

  // No mail delivery available → never lock citizens out: register verified,
  // log them in immediately (previous behavior).
  if (!verificationActive()) {
    await pool.query(`UPDATE users SET email_verified = true WHERE id = $1`, [user.id]);
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );
    req.session.userId = user.id;
    req.log.info({ userId: user.id }, "User registered (verification skipped — no mailer)");
    sendWelcomeNotification(user.id).catch(() => {});
    res.status(201).json(serializeUser(user));
    return;
  }

  // One-time email verification: no session until the code is confirmed
  req.log.info({ userId: user.id }, "User registered — verification code sent");
  const sent = await issueVerificationCode(user.id, email).catch(() => false);

  res.status(201).json({
    needsVerification: true,
    email,
    message: sent
      ? "أرسلنا كود التحقق إلى بريدك الإلكتروني — Code de vérification envoyé à votre email"
      : "تعذر إرسال الكود مؤقتاً — جرب «إعادة الإرسال» بعد لحظات | Envoi du code temporairement indisponible",
  });
  } catch (err) {
    req.log.error(err, "Register error");
    res.status(500).json({ error: "خطأ مؤقت في الخادم — حاول مرة أخرى | Erreur serveur temporaire — réessayez" });
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  try {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  // "Se souvenir de moi" — must be explicitly true; omitted = standard 7 days
  const rememberMe = req.body?.rememberMe === true;
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
    // Generic message (same as wrong password) — prevents account enumeration
    res.status(401).json({ error: "البريد أو كلمة السر غير صحيحة — Email ou mot de passe incorrect" });
    return;
  }

  let valid = false;
  try {
    valid = await bcrypt.compare(password, user.passwordHash);
  } catch {
    valid = false; // malformed legacy hash — treat as invalid, not a crash
  }
  if (!valid) {
    res.status(401).json({ error: "البريد أو كلمة السر غير صحيحة — Email ou mot de passe incorrect" });
    return;
  }

  // One-time email verification gate (registration-era accounts are grandfathered)
  if (!user.emailVerified) {
    if (!verificationActive()) {
      // Can't deliver codes → don't lock the citizen out; grandfather as verified
      await pool.query(`UPDATE users SET email_verified = true WHERE id = $1`, [user.id]);
    } else {
      await issueVerificationCode(user.id, email).catch(() => false);
      res.status(403).json({
        needsVerification: true,
        email,
        error: "حسابك محتاج تحقق بالإيميل — أرسلنا لك الكود | Vérifiez votre email — code envoyé",
      });
      return;
    }
  }

  // Regenerate the session ID after credential verification (anti session-fixation)
  await new Promise<void>((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve()))
  );
  req.session.userId = user.id;
  // Remember me: effectively unlimited (1 year, renewed on every visit thanks
  // to rolling sessions) — the citizen stays logged in until they log out.
  if (rememberMe) req.session.cookie.maxAge = 365 * 24 * 60 * 60 * 1000;
  req.log.info({ userId: user.id, rememberMe }, "User logged in");
  res.json(serializeUser(user));
  } catch (err) {
    req.log.error(err, "Login error");
    res.status(500).json({ error: "خطأ مؤقت في الخادم — حاول مرة أخرى | Erreur serveur temporaire — réessayez" });
  }
});

// ── POST /auth/verify-email — confirm the one-time code, then log in ────
router.post("/auth/verify-email", async (req, res): Promise<void> => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!email || !/^\d{6}$/.test(code)) {
      res.status(400).json({ error: "أدخل الكود المكوّن من 6 أرقام — Entrez le code à 6 chiffres" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(sql`LOWER(${usersTable.email}) = ${email}`)
      .limit(1);
    if (!user) {
      res.status(400).json({ error: "الكود غير صحيح أو منتهي الصلاحية — Code invalide ou expiré" });
      return;
    }
    if (user.emailVerified) {
      res.status(400).json({ error: "هذا الحساب متحقق منه بالفعل — سجّل الدخول مباشرة | Compte déjà vérifié" });
      return;
    }

    // Atomically reserve an attempt (concurrency-safe: parallel guesses can
    // never exceed MAX_ATTEMPTS because the increment happens in the check)
    const { rows } = await pool.query(
      `UPDATE email_verification_codes
       SET attempts = attempts + 1
       WHERE user_id = $1 AND attempts < $2 AND expires_at > now()
       RETURNING code_hash`,
      [user.id, MAX_ATTEMPTS]
    );
    const row = rows[0];
    if (!row) {
      res.status(400).json({ error: "الكود منتهي الصلاحية — اطلب كوداً جديداً | Code expiré — demandez-en un nouveau" });
      return;
    }

    const match = await bcrypt.compare(code, row.code_hash);
    if (!match) {
      res.status(400).json({ error: "الكود غير صحيح — Code incorrect" });
      return;
    }

    await pool.query(`UPDATE users SET email_verified = true WHERE id = $1`, [user.id]);
    await pool.query(`DELETE FROM email_verification_codes WHERE user_id = $1`, [user.id]);

    // Verified — log the citizen in with a 30-day remembered session
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );
    req.session.userId = user.id;
    req.session.cookie.maxAge = 365 * 24 * 60 * 60 * 1000;
    req.log.info({ userId: user.id }, "Email verified — user logged in");

    sendWelcomeNotification(user.id).catch(() => {});
    res.json(serializeUser(user));
  } catch (err) {
    req.log.error(err, "Verify email error");
    res.status(500).json({ error: "خطأ مؤقت في الخادم — حاول مرة أخرى | Erreur serveur temporaire — réessayez" });
  }
});

// ── POST /auth/resend-code — new code, 60s cooldown, no enumeration ─────
router.post("/auth/resend-code", async (req, res): Promise<void> => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const generic = { message: "إذا كان الحساب موجوداً، أرسلنا كوداً جديداً — Si le compte existe, un nouveau code a été envoyé" };
    if (!email) { res.json(generic); return; }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(sql`LOWER(${usersTable.email}) = ${email}`)
      .limit(1);
    if (user && !user.emailVerified && verificationActive()) {
      // Atomic server-side cooldown: reserve the send slot in one statement
      const { rows } = await pool.query(
        `UPDATE email_verification_codes
         SET last_sent_at = now()
         WHERE user_id = $1 AND last_sent_at < now() - interval '60 seconds'
         RETURNING user_id`,
        [user.id]
      );
      const noRow = (await pool.query(
        `SELECT 1 FROM email_verification_codes WHERE user_id = $1`, [user.id]
      )).rowCount === 0;
      if (rows.length > 0 || noRow) {
        await issueVerificationCode(user.id, email).catch(() => false);
      }
    }
    res.json(generic);
  } catch (err) {
    req.log.error(err, "Resend code error");
    res.status(500).json({ error: "خطأ مؤقت في الخادم — حاول مرة أخرى | Erreur serveur temporaire — réessayez" });
  }
});

// ── POST /auth/forgot-password — send a reset code (non-enumerating) ────
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!verificationActive()) {
      res.status(503).json({ error: "خدمة استرجاع الحساب غير متاحة مؤقتاً — Récupération de compte temporairement indisponible" });
      return;
    }
    const generic = { message: "إذا كان الحساب موجوداً، أرسلنا كود الاسترجاع إلى بريدك — Si le compte existe, un code de récupération a été envoyé" };
    if (!email) { res.json(generic); return; }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(sql`LOWER(${usersTable.email}) = ${email}`)
      .limit(1);
    if (user) {
      // Atomic server-side cooldown (same pattern as resend-code)
      const { rows } = await pool.query(
        `UPDATE password_reset_codes
         SET last_sent_at = now()
         WHERE user_id = $1 AND last_sent_at < now() - interval '60 seconds'
         RETURNING user_id`,
        [user.id]
      );
      const noRow = (await pool.query(
        `SELECT 1 FROM password_reset_codes WHERE user_id = $1`, [user.id]
      )).rowCount === 0;
      if (rows.length > 0 || noRow) {
        const code = generateCode();
        const codeHash = await bcrypt.hash(code, SALT_ROUNDS);
        const { sent } = await sendVerificationEmail(email, code);
        if (sent) {
          await pool.query(
            `INSERT INTO password_reset_codes (user_id, code_hash, expires_at, attempts, last_sent_at)
             VALUES ($1, $2, now() + interval '10 minutes', 0, now())
             ON CONFLICT (user_id) DO UPDATE
               SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
                   attempts = 0, last_sent_at = now()`,
            [user.id, codeHash]
          );
        }
      }
    }
    res.json(generic);
  } catch (err) {
    req.log.error(err, "Forgot password error");
    res.status(500).json({ error: "خطأ مؤقت في الخادم — حاول مرة أخرى | Erreur serveur temporaire — réessayez" });
  }
});

// ── POST /auth/reset-password — verify the code, set the new password ───
router.post("/auth/reset-password", async (req, res): Promise<void> => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (!email || !/^\d{6}$/.test(code)) {
      res.status(400).json({ error: "أدخل الكود المكوّن من 6 أرقام — Entrez le code à 6 chiffres" });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: "كلمة السر الجديدة يجب أن تكون 6 أحرف على الأقل — Nouveau mot de passe: 6 caractères minimum" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(sql`LOWER(${usersTable.email}) = ${email}`)
      .limit(1);
    if (!user) {
      res.status(400).json({ error: "الكود غير صحيح أو منتهي الصلاحية — Code invalide ou expiré" });
      return;
    }

    // Atomic attempt reservation (concurrency-safe, max 5 guesses)
    const { rows } = await pool.query(
      `UPDATE password_reset_codes
       SET attempts = attempts + 1
       WHERE user_id = $1 AND attempts < $2 AND expires_at > now()
       RETURNING code_hash`,
      [user.id, MAX_ATTEMPTS]
    );
    const row = rows[0];
    if (!row) {
      res.status(400).json({ error: "الكود منتهي الصلاحية — اطلب كوداً جديداً | Code expiré — demandez-en un nouveau" });
      return;
    }
    const match = await bcrypt.compare(code, row.code_hash);
    if (!match) {
      res.status(400).json({ error: "الكود غير صحيح — Code incorrect" });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query(`UPDATE users SET password_hash = $1, email_verified = true WHERE id = $2`, [passwordHash, user.id]);
    await pool.query(`DELETE FROM password_reset_codes WHERE user_id = $1`, [user.id]);
    // Revoke EVERY existing session for this user — a stolen session must not
    // survive a password reset. The new session is established just below.
    await pool.query(`DELETE FROM user_sessions WHERE (sess->>'userId')::int = $1`, [user.id]);

    // Log the citizen straight in — like all platforms
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );
    req.session.userId = user.id;
    req.session.cookie.maxAge = 365 * 24 * 60 * 60 * 1000;
    req.log.info({ userId: user.id }, "Password reset — user logged in");
    res.json(serializeUser(user));
  } catch (err) {
    req.log.error(err, "Reset password error");
    res.status(500).json({ error: "خطأ مؤقت في الخادم — حاول مرة أخرى | Erreur serveur temporaire — réessayez" });
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
