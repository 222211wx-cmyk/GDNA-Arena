import { Router, type IRouter, type Response } from "express";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, usersTable } from "../lib/db";
import { pool as nullablePool } from "../lib/db";
import { logger } from "../lib/logger";
import { disconnectSessionSockets, disconnectUserSockets } from "../lib/signaling";
import { moderateText, hasBlockedKeyword } from "../lib/moderate";
import { isAdultForGames, normalizeBirthDate } from "../lib/age";
import { deleteAccountClips } from "../lib/clip-account-delete.js";
import { deleteAccountCitizenSocial } from "../lib/citizen-media-cleanup.js";
import { ClipUploadError } from "../lib/clips-upload-protocol.js";
import { configureSessionLifetime, sessionLifetime, SHORT_SESSION_TTL_MS } from "../lib/session-policy";
import { revokeCallPushSession } from "../lib/push-disabled";
import { PhoneRecoveryError, requireRecoveryUser, revokeRecoveryPushBindings } from "../lib/phone-recovery";
import { authorizeNewSession, lockLiveSession, SessionRevokedError } from "../lib/session-security";
import { sessionCredentialEpoch } from "../lib/session-policy";
import { completeOfflineRecoveryRevocation } from "../lib/offline-recovery-revocation";

const pool = nullablePool!;

// Citizen login remains username + password, with no citizen email or mail.
// Latest owner decision enables optional, verified Firebase SMS recovery.
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
    hasActiveSubscription: user.hasActiveSubscription === true,
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
    .where(sql`LOWER(${usersTable.username}) = LOWER(${username})`)
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

  // Simple flow: register → logged in immediately, persistent rolling session.
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
  authorizeNewSession(req.session, 0);
  configureSessionLifetime(req.session);
  await new Promise<void>((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
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
  // Trim only surrounding whitespace. Removing internal spaces could map an
  // existing "a b" account onto another citizen's "ab" account.
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  // Persist by default; an explicit unchecked preference keeps the short policy.
  const rememberMe = req.body?.rememberMe !== false;
  if (!username || !password) {
    res.status(400).json({ error: "اسم المستخدم وكلمة السر مطلوبان — Nom d'utilisateur et mot de passe requis" });
    return;
  }

  const matches = await db
    .select({ user: usersTable, credentialEpoch: sql<number>`credential_epoch` })
    .from(usersTable)
    .where(sql`LOWER(${usersTable.username}) = LOWER(${username})`)
    .orderBy(usersTable.id)
    .limit(2);

  // Legacy duplicates must never be resolved by picking an arbitrary account.
  if (matches.length !== 1) {
    res.status(401).json({ error: "الاسم أو كلمة السر غير صحيحة — Nom ou mot de passe incorrect" });
    return;
  }
  // Capture the epoch from the SAME snapshot as the verified password.
  const [{ user, credentialEpoch }] = matches;

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

  // The fenced store checks the verified epoch while holding its own user
  // SHARE lock. Do not hold a different connection's user UPDATE lock across
  // session.save: that would deadlock with the epoch-aware store.
  const previousSessionId = req.sessionID;
  const previousSessionUserId = req.session.userId;
  await new Promise<void>((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  );
  disconnectSessionSockets(previousSessionId);
  if (previousSessionUserId) {
    void revokeCallPushSession(previousSessionUserId, previousSessionId).catch(() => {});
  }
  req.session.userId = user.id;
  authorizeNewSession(req.session, credentialEpoch);
  configureSessionLifetime(req.session, rememberMe);
  await new Promise<void>((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
  req.log.info({ userId: user.id, rememberMe }, "User logged in");
  res.json(serializeUser(user));
  } catch (err) {
    if (err instanceof SessionRevokedError) {
      res.status(401).json({ error: "الاسم أو كلمة السر غير صحيحة — Nom ou mot de passe incorrect" });
      return;
    }
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

    // Preserve an explicit short-session choice through credential rotation.
    const rememberMe = sessionLifetime(req.session) > SHORT_SESSION_TTL_MS;
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const client = await pool.connect();
    let revokedSessionIds: string[] = [];
    let credentialEpoch: number;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      // Shared reset/enrollment order: E2EE advisory lock -> user -> SID.
      await client.query("SELECT pg_advisory_xact_lock(47201, 1)");
      const user = await requireRecoveryUser(client, userId, req.sessionID);
      await lockLiveSession(client, userId, req.sessionID, sessionCredentialEpoch(req.session));
      let valid = false;
      try { valid = await bcrypt.compare(currentPassword, user.password_hash); } catch { /* fail closed */ }
      if (!valid) {
        throw new PhoneRecoveryError(400, "كلمة السر الحالية غير صحيحة — Mot de passe actuel incorrect");
      }
      // Compare and replace under the SAME locked credential snapshot.
      const updated = await client.query<{ credential_epoch: number }>(
        `UPDATE users SET password_hash=$1, credential_epoch=credential_epoch+1
         WHERE id=$2 RETURNING credential_epoch`, [passwordHash, userId],
      );
      credentialEpoch = updated.rows[0].credential_epoch;
      await client.query(
        `INSERT INTO auth_offline_recovery_revocations (user_id, credential_epoch) VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET credential_epoch=EXCLUDED.credential_epoch, created_at=NOW()`,
        [userId, credentialEpoch],
      );
      const revokedSessions = await client.query<{ sid: string }>(
        "DELETE FROM user_sessions WHERE sess->>'userId'=$1::text RETURNING sid", [userId],
      );
      revokedSessionIds = revokedSessions.rows.map(({ sid }) => sid);
      await revokeRecoveryPushBindings(client, userId);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
    // Revoke pending-upgrade and fully registered realtime channels for every
    // deleted session before issuing an epoch-fenced replacement after commit.
    for (const sid of revokedSessionIds) disconnectSessionSockets(sid);
    disconnectUserSockets(userId);
    const firebaseRevoked = await completeOfflineRecoveryRevocation(userId);
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );
    req.session.userId = userId;
    authorizeNewSession(req.session, credentialEpoch);
    configureSessionLifetime(req.session, rememberMe);
    await new Promise<void>((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    req.log.info({ userId }, "Password changed from settings");
    res.json({
      message: "تم تغيير كلمة السر بنجاح ✅ — Mot de passe modifié",
      firebaseRevocationPending: !firebaseRevoked,
    });
  } catch (err) {
    if (err instanceof PhoneRecoveryError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof SessionRevokedError) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
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

  let user: typeof usersTable.$inferSelect | undefined;
  try {
    [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
  } catch (err) {
    req.log.error(err, "Session identity lookup unavailable");
    res.status(503).json({ error: "Session temporarily unavailable — please retry" });
    return;
  }

  if (!user) {
    const sessionId = req.sessionID;
    try {
      await new Promise<void>((resolve, reject) => req.session.destroy(err => err ? reject(err) : resolve()));
    } catch (err) {
      req.log.error(err, "Unable to revoke missing-account session");
      res.status(503).json({ error: "Session temporarily unavailable — please retry" });
      return;
    }
    disconnectSessionSockets(sessionId);
    clearSessionCookie(res);
    res.status(401).json({ error: "User not found" });
    return;
  }

  // Renew only the still-live row. A session loaded before logout, password
  // revocation, or expiry must not be recreated by express-session's upsert.
  // Cookie-only changes are excluded from its session hash (resave is false);
  // the middleware's subsequent touch is UPDATE-only, never an INSERT.
  try {
    const ttl = sessionLifetime(req.session);
    const expires = new Date(Date.now() + ttl).toISOString();
    const renewed = await pool.query(
      `UPDATE user_sessions
       SET sess = jsonb_set(
             jsonb_set(sess::jsonb, '{cookie,originalMaxAge}', to_jsonb($3::bigint)),
             '{cookie,expires}', to_jsonb($4::text)
           )::json,
           expire = $4::timestamptz
       WHERE sid = $1 AND sess->>'userId' = $2::text AND expire > NOW()
         AND COALESCE(sess->>'credentialEpoch', '0') = $5::text
         AND EXISTS (SELECT 1 FROM users u WHERE u.id=$2::integer AND u.credential_epoch=$5::integer)
       RETURNING sid`,
      [req.sessionID, userId, ttl, expires, sessionCredentialEpoch(req.session)],
    );
    if (!renewed.rowCount) {
      disconnectSessionSockets(req.sessionID);
      await new Promise<void>((resolve, reject) =>
        req.session.destroy(err => err ? reject(err) : resolve()),
      );
      clearSessionCookie(res);
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    req.session.cookie.maxAge = ttl;
  } catch (err) {
    req.log.error(err, "Session renewal unavailable");
    res.status(503).json({ error: "Session temporarily unavailable — please retry" });
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
      await client.query("SELECT pg_advisory_xact_lock(47201, 1)");
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
      await lockLiveSession(client, userId, req.sessionID, sessionCredentialEpoch(req.session));
      await client.query(`
        UPDATE users
        SET username = $1, email = $2, password_hash = 'DELETED',
            birth_date = NULL, last_seen_at = NOW(), credential_epoch = credential_epoch + 1
        WHERE id = $3
      `, [anonymousName, `${anonymousName}@deleted.gdna`, userId]);
      await client.query(
        `INSERT INTO auth_offline_recovery_revocations (user_id, credential_epoch)
         SELECT id, credential_epoch FROM users WHERE id=$1
         ON CONFLICT (user_id) DO UPDATE SET credential_epoch=EXCLUDED.credential_epoch, created_at=NOW()`,
        [userId],
      );
      // Soft-deletion does not fire FK cascades. Release the phone mapping,
      // but preserve global consumed-event digests so erasure cannot replay it.
      await client.query("DELETE FROM auth_recovery_phones WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM auth_recovery_codes WHERE user_id = $1", [userId]);
      await revokeRecoveryPushBindings(client, userId);
      await client.query("DELETE FROM dm_user_e2ee_keys WHERE user_id=$1", [userId]);
      await deleteAccountClips(client, userId);
      await deleteAccountCitizenSocial(client, userId);
      await client.query("DELETE FROM dm_send_receipts WHERE sender_id=$1", [userId]);
      // Account erasure is a soft-delete: FK cascades alone cannot erase AI memory.
      await client.query("DELETE FROM gdna_memory WHERE user_id=$1", [userId]);
      await client.query("DELETE FROM gdna_audit WHERE user_id=$1", [userId]);
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
    const firebaseRevoked = await completeOfflineRecoveryRevocation(userId);
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
