import { Router, type IRouter, type Response } from "express";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { pool as nullablePool } from "@workspace/db";
import { logger } from "../lib/logger";
import { disconnectSessionSockets, disconnectUserSockets } from "../lib/signaling";
import { moderateText, hasBlockedKeyword } from "../lib/moderate";
import { isAdultForGames, normalizeBirthDate } from "../lib/age";
import { revokeAllCallPushSessions, revokeCallPushSession } from "../lib/firebase-call-push";
import { deleteAccountClips } from "../lib/clip-account-delete.js";
import { deleteAccountCitizenSocial } from "../lib/citizen-media-cleanup.js";
import { ClipUploadError } from "../lib/clip-upload-protocol.js";

const pool = nullablePool!;

// FINAL OWNER DECISION (Aug 2026): citizen auth is username + password only.
// No citizen email input, email verification, recovery codes, or mail provider.
// Register once → logged in immediately → stays in via long rolling session.

// ── رسائل الترحيب — يتلقاها كل مواطن جديد فور تسجيله ─────────────
const WELCOME_POOL = [
  { icon: "👑", title: "⚡ المملكة تستدعيك — EMPIRE ETERNAL", body: "أنت الآن جزء من الإمبراطورية الأكبر في تاريخ المحتوى الرقمي. استكشف الـ Legends، صوّت في GlobalStar، وشارك في Pulse — مكانك هنا يستحق أن يُرى." },
  { icon: "🏛️", title: "🏛️ القوة الحقيقية تبدأ من هنا", body: "EMPIRE ETERNAL ليس مجرد موقع — إنه ميدان السيادة الرقمية. حقق إنجازاتك في الألعاب، ابنِ رصيدك في الشرف، وأصبح أسطورة يعرفها الجميع." },
  { icon: "🔥", title: "🔥 الإمبراطورية تنتظر مواطناً مثلك", body: "الأبطال لا يُنتظرون — يتقدمون. زُر GlobalStar وصوّت لمن يستحق، أو أدخل الميدان في PLAY وأثبت من أنت. الأسطورة تبدأ الآن." },
  { icon: "⚔️", title: "⚔️ مرحباً في عالم لا يُنسى", body: "من اللحظة التي قرأت فيها هذا، أنت لستَ زائراً — أنت مواطن في EMPIRE ETERNAL. اكتشف الـ Legends، واترك بصمتك في الـ Pulse، وابنِ إرثك من الصفر." },
  { icon: "🌌", title: "🌌 الكون الرقمي فتح أبوابه", body: "EMPIRE ETERNAL — حيث يلتقي الرياضة والموسيقى والسينما والتراث في ميدان واحد. صوّتك يصنع التاريخ. مكانك محجوز بين الكبار." },
  { icon: "🏆", title: "🏆 البطل لا يحتاج دعوة — هو يدخل", body: "منصة Arena Qaisypro جاهزة لك: Legends من كل الحضارات، GlobalStar لأفضل المواهب، ألعاب ومعارك وشرف. أين ستبدأ رحلتك؟" },
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
const SESSION_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

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
    balance: user.balance,
    xp: user.xp,
    gamesPlayed: user.gamesPlayed,
    wins: user.wins,
    canClaimDaily: canClaimDaily(user.lastDailyReward),
    isAdmin: user.isAdmin === true,
    isAdult: isAdultForGames(user.birthDate),
  };
}

function clearSessionCookie(res: Response): void {
  res.clearCookie("connect.sid", SESSION_COOKIE_OPTIONS);
}

router.post("/auth/register", async (req, res): Promise<void> => {
  try {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const birthDate = normalizeBirthDate(req.body?.birthDate);
  if (!username || !password || !birthDate) {
    res.status(400).json({ error: "الاسم وكلمة السر وتاريخ الميلاد مطلوبون — Nom, mot de passe et date de naissance requis" });
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
    .where(sql`LOWER(${usersTable.username}) = ${username.toLowerCase()}`)
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({
      error: "اسم المستخدم مأخوذ — اختر اسماً آخر | Nom d'utilisateur déjà pris",
    });
    return;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  // Legacy/system tables still require a unique internal email value. Citizens
  // never provide, receive, or authenticate with this private placeholder.
  const internalEmail = `citizen-${randomUUID()}@gdna.internal`;
  let user;
  try {
    [user] = await db
      .insert(usersTable)
      .values({ username, email: internalEmail, passwordHash, birthDate })
      .returning();
  } catch (err: any) {
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      // Unique-index race: someone registered the same username concurrently.
      res.status(409).json({ error: "اسم المستخدم مأخوذ — اختر اسماً آخر | Nom d'utilisateur déjà pris" });
      return;
    }
    throw err;
  }

  // Simple flow: register → logged in immediately, 30-day remembered session.
  // Regeneration can replace an already-authenticated session, so capture its
  // owner before Express destroys the old session object. Never bind cleanup
  // to the newly-created citizen.
  const previousSessionId = req.sessionID;
  const previousSessionUserId = req.session.userId;
  await new Promise<void>((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve()))
  );
  disconnectSessionSockets(previousSessionId);
  // Session rotation invalidates any push installation bound to the old
  // session as well as its WebSocket. This is best effort and never delays a
  // successful credential login when Firebase is unavailable.
  if (previousSessionUserId) {
    void revokeCallPushSession(previousSessionUserId, previousSessionId).catch(() => {});
  }
  req.session.userId = user.id;
  req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
  req.log.info({ userId: user.id }, "User registered — logged in");
  sendWelcomeNotification(user.id).catch(() => {});
  res.status(201).json(serializeUser(user));
  } catch (err) {
    req.log.error(err, "Register error");
    res.status(500).json({ error: "خطأ مؤقت في الخادم — حاول مرة أخرى | Erreur serveur temporaire — réessayez" });
  }
});

// Existing citizens set their birth date once. Registration remains open to
// every age; the value is used only by the Games 18+ access rule.
router.post("/auth/birth-date", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: "سجّل الدخول أولاً — Login required" });
      return;
    }

    const birthDate = normalizeBirthDate(req.body?.birthDate);
    if (!birthDate) {
      res.status(400).json({ error: "تاريخ الميلاد غير صالح — Date de naissance invalide" });
      return;
    }

    const [existing] = await db
      .select({ birthDate: usersTable.birthDate })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "الحساب غير موجود — Account not found" });
      return;
    }
    if (existing.birthDate) {
      res.status(409).json({ error: "تم تسجيل تاريخ الميلاد من قبل — Birth date already recorded" });
      return;
    }

    await db
      .update(usersTable)
      .set({ birthDate })
      .where(eq(usersTable.id, userId));

    res.json({ saved: true, isAdult: isAdultForGames(birthDate) });
  } catch (err) {
    req.log.error(err, "Birth date registration error");
    res.status(500).json({ error: "خطأ مؤقت في الخادم — حاول مرة أخرى" });
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  try {
  const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  // "Se souvenir de moi" — must be explicitly true; omitted = standard 7 days
  const rememberMe = req.body?.rememberMe === true;
  if (!username || !password) {
    res.status(400).json({ error: "اسم المستخدم وكلمة السر مطلوبان — Nom d'utilisateur et mot de passe requis" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(sql`LOWER(${usersTable.username}) = ${username}`)
    .orderBy(usersTable.id)
    .limit(1);

  if (!user) {
    // Generic message (same as wrong password) — prevents account enumeration
    res.status(401).json({ error: "الاسم أو كلمة السر غير صحيحة — Nom ou mot de passe incorrect" });
    return;
  }

  let valid = false;
  try {
    valid = await bcrypt.compare(password, user.passwordHash);
  } catch {
    valid = false; // malformed legacy hash — treat as invalid, not a crash
  }
  if (!valid) {
    res.status(401).json({ error: "الاسم أو كلمة السر غير صحيحة — Nom ou mot de passe incorrect" });
    return;
  }

  // Regenerate the session ID after credential verification (anti session-fixation)
  const previousSessionId = req.sessionID;
  const previousSessionUserId = req.session.userId;
  await new Promise<void>((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve()))
  );
  disconnectSessionSockets(previousSessionId);
  if (previousSessionUserId) {
    void revokeCallPushSession(previousSessionUserId, previousSessionId).catch(() => {});
  }
  req.session.userId = user.id;
  // Remember me: 30-day secure token cookie, renewed on every visit (rolling)
  // → the citizen enters instantly, like YouTube, until they log out.
  if (rememberMe) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
  req.log.info({ userId: user.id, rememberMe }, "User logged in");
  res.json(serializeUser(user));
  } catch (err) {
    req.log.error(err, "Login error");
    res.status(500).json({ error: "خطأ مؤقت في الخادم — حاول مرة أخرى | Erreur serveur temporaire — réessayez" });
  }
});

// ── POST /auth/change-password — from settings, while logged in ─────────
router.post("/auth/change-password", async (req, res): Promise<void> => {
  try {
    const userId = req.session.userId;
    if (!userId) {
      res.status(401).json({ error: "سجّل الدخول أولاً — Connectez-vous d'abord" });
      return;
    }
    const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (newPassword.length < 6) {
      res.status(400).json({ error: "كلمة السر الجديدة يجب أن تكون 6 أحرف على الأقل — Nouveau mot de passe: 6 caractères minimum" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.status(401).json({ error: "سجّل الدخول أولاً — Connectez-vous d'abord" });
      return;
    }
    let valid = false;
    try {
      valid = await bcrypt.compare(currentPassword, user.passwordHash);
    } catch {
      valid = false;
    }
    if (!valid) {
      res.status(400).json({ error: "كلمة السر الحالية غير صحيحة — Mot de passe actuel incorrect" });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, userId]);
    // Revoke every OTHER session — a stolen session must not survive a
    // password change. The current session is re-established below.
    const revokedSessions = await pool.query<{ sid: string }>(
      `DELETE FROM user_sessions
       WHERE (sess->>'userId')::int = $1
       RETURNING sid`,
      [userId],
    );
    // Revoke pending-upgrade and fully registered realtime channels for every
    // deleted session before issuing the replacement credential.
    for (const { sid } of revokedSessions.rows) disconnectSessionSockets(sid);
    disconnectUserSockets(userId);
    const firebaseRevoked = await revokeAllCallPushSessions(userId);
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );
    req.session.userId = userId;
    req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    req.log.info({ userId }, "Password changed from settings");
    res.json({
      message: "تم تغيير كلمة السر بنجاح ✅ — Mot de passe modifié",
      firebaseRevocationPending: !firebaseRevoked,
    });
  } catch (err) {
    req.log.error(err, "Change password error");
    res.status(500).json({ error: "خطأ مؤقت في الخادم — حاول مرة أخرى | Erreur serveur temporaire — réessayez" });
  }
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const sessionId = req.sessionID;
  const userId = req.session.userId;
  try {
    await new Promise<void>((resolve, reject) =>
      req.session.destroy((err) => (err ? reject(err) : resolve()))
    );
  } catch (error) {
    logger.error(error, "Session destroy error — trying direct store revocation");
    try {
      // A failed store callback must never leave a valid session behind while
      // the UI claims logout succeeded.
      await pool.query(`DELETE FROM user_sessions WHERE sid = $1`, [sessionId]);
    } catch (fallbackError) {
      logger.error(fallbackError, "Direct session revocation failed");
      disconnectSessionSockets(sessionId);
      clearSessionCookie(res);
      res.status(500).json({ error: "تعذر إنهاء الجلسة — حاول مرة أخرى" });
      return;
    }
  }

  disconnectSessionSockets(sessionId);
  const firebaseRevoked = userId ? await revokeCallPushSession(userId, sessionId) : true;
  clearSessionCookie(res);
  res.json({ message: "Logged out", firebaseRevocationPending: !firebaseRevoked });
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
    const sessionId = req.sessionID;
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    disconnectSessionSockets(sessionId);
    clearSessionCookie(res);
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
    // Anonymise account/identity snapshots while preserving financial history.
    // This explicit erasure also releases owned clip media via a durable outbox.
    const anonymousName = `deleted_user_${userId}`;
    const client = await pool.connect();
    let revokedSessionIds: string[] = [];
    try {
      await client.query("BEGIN");
      await client.query(`
        UPDATE users
        SET username = $1, email = $2, password_hash = 'DELETED',
            birth_date = NULL, last_seen_at = NOW()
        WHERE id = $3
      `, [anonymousName, `${anonymousName}@deleted.gdna`, userId]);
      await deleteAccountClips(client, userId);
      await deleteAccountCitizenSocial(client, userId);
      // Only erase display names from records with an immutable ownership link.
      // Never match historical snapshots by username: bots, stars, and seeded
      // records can legitimately reuse a citizen's display name.
      await client.query(
        `UPDATE citizen_dna
         SET username = $1,
             dna_string = LEFT(dna_string, 56) || 'AAAAAAAA'
         WHERE citizen_id = $2`,
        [anonymousName, userId],
      );
      await client.query(
        `UPDATE gs_players SET username = $1 WHERE user_id = $2`,
        [anonymousName, userId],
      );
      // Older deployments may have profile fields that are not in the current
      // shared schema. Erase them when present without assuming those columns
      // exist in every environment.
      const optionalPiiColumns = await client.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'users'
           AND column_name = ANY(ARRAY['bio', 'avatar', 'avatar_url'])`,
      );
      const allowedPiiColumns = optionalPiiColumns.rows
        .map(({ column_name }) => column_name)
        .filter((column): column is 'bio' | 'avatar' | 'avatar_url' =>
          column === 'bio' || column === 'avatar' || column === 'avatar_url',
        );
      if (allowedPiiColumns.length > 0) {
        await client.query(
          `UPDATE users
           SET ${allowedPiiColumns.map((column) => `"${column}" = NULL`).join(", ")}
           WHERE id = $1`,
          [userId],
        );
      }
      const revokedSessions = await client.query<{ sid: string }>(
        `DELETE FROM user_sessions
         WHERE (sess->>'userId')::int = $1
         RETURNING sid`,
        [userId],
      );
      revokedSessionIds = revokedSessions.rows.map(({ sid }) => sid);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Also wipe any stored legal consent rows
    await pool.query(
      `DELETE FROM user_legal_consents WHERE user_id = $1`, [userId]
    ).catch(() => {}); // table may not exist yet — ignore

    for (const sessionId of revokedSessionIds) disconnectSessionSockets(sessionId);
    disconnectUserSockets(userId);
    const firebaseRevoked = await revokeAllCallPushSessions(userId);
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    clearSessionCookie(res);
    res.json({
      message: "Account erased. All personal data has been deleted per GDPR Art. 17.",
      firebaseRevocationPending: !firebaseRevoked,
    });
  } catch (err) {
    logger.error(err, "GDPR erasure error");
    if (err instanceof ClipUploadError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "Erasure failed. Contact legal@gdna-arena.com." });
  }
});

export default router;
