import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcrypt";
import { pool } from "../lib/db";
import {
  BindRecoveryPhoneBody, BindRecoveryPhoneResponse, GetRecoveryConfigResponse,
  GetRecoveryPhoneResponse, RemoveRecoveryPhoneBody, RemoveRecoveryPhoneResponse,
  ResetRecoveryPasswordBody, ResetRecoveryPasswordResponse,
  AccessRecoveryAccountBody, AccessRecoveryAccountResponse,
} from "../lib/api-zod";
import { disconnectSessionSockets, disconnectUserSockets } from "../lib/signaling";
import {
  PhoneRecoveryError, RECOVERY_UNAVAILABLE, assertFreshPhoneProof, consumeRecoveryProof,
  enforceRecoveryRateLimit, lockRecoveryPhone, maskRecoveryPhone, recoveryFirebaseConfig,
  recoveryTransaction, requireCurrentRecoveryPassword, requireRecoveryUser,
  revokeRecoveryPushBindings, validRecoveryPassword, verifyPhoneProof,
} from "../lib/phone-recovery";
import { completeOfflineRecoveryRevocation } from "../lib/offline-recovery-revocation";
import { authorizeNewSession, SessionRevokedError } from "../lib/session-security";
import { configureSessionLifetime } from "../lib/session-policy";
import { revokeCallPushSession } from "../lib/firebase-call-push";

const router: IRouter = Router();
const BASE = "/auth/recovery";

// Reads have their own lightweight shield; mutations additionally use shared
// PostgreSQL IP/user/phone counters, not per-process-only replay/abuse state.
router.use(BASE, (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.get(`${BASE}/config`, rateLimit({
  windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests. Please retry later." },
}), (_req, res): void => {
  const firebaseConfig = recoveryFirebaseConfig();
  res.json(GetRecoveryConfigResponse.parse({ configured: firebaseConfig !== null, firebaseConfig }));
});

function allowedMutationOrigin(req: Request): boolean {
  const allowed = new Set<string>();
  if (req.get("host")) allowed.add(`${req.protocol}://${req.get("host")}`);
  if (process.env.REPLIT_DEV_DOMAIN) allowed.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  if (process.env.REPLIT_EXPO_DEV_DOMAIN) allowed.add(`https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`);
  for (const domain of (process.env.REPLIT_DOMAINS ?? "").split(",")) {
    if (domain.trim()) allowed.add(`https://${domain.trim()}`);
  }
  if (process.env.NODE_ENV !== "production") {
    allowed.add("http://localhost");
    allowed.add("http://localhost:80");
  }
  const origin = req.get("origin");
  if (origin) {
    try {
      const url = new URL(origin);
      // Never trust Host/forwarded-host as an origin allowlist.
      return url.origin === origin && allowed.has(origin);
    } catch { return false; }
  }
  const referer = req.get("referer");
  if (referer) {
    try { return allowed.has(new URL(referer).origin); } catch { return false; }
  }
  // Native clients have no browser Origin/Fetch Metadata. Requiring JSON below
  // prevents no-Origin HTML forms; a cross-origin browser JSON request must
  // preflight and cannot pass the server's explicit Origin check.
  return !req.get("sec-fetch-site") || req.get("sec-fetch-site") === "same-origin";
}

function mutationGuard(req: Request, res: Response, next: NextFunction): void {
  if (!allowedMutationOrigin(req)) {
    res.status(403).json({ error: "Request origin is not allowed.", code: "RECOVERY_ORIGIN" });
    return;
  }
  if (!req.is("application/json")) {
    res.status(400).json({ error: "A JSON request is required." });
    return;
  }
  next();
}

function replyError(req: Request, res: Response, error: unknown): void {
  if (error instanceof PhoneRecoveryError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  // PostgreSQL/Firebase exception details may contain sensitive parameters.
  // In particular, never log a duplicate-phone constraint exception.
  if ((error as { code?: unknown })?.code === "23505") {
    res.status(409).json({ error: "The recovery phone could not be linked." });
    return;
  }
  req.log.warn("Phone recovery database/service operation unavailable");
  res.status(503).json({ error: RECOVERY_UNAVAILABLE });
}

async function limitMutation(req: Request, authenticated: boolean): Promise<number | undefined> {
  await enforceRecoveryRateLimit("ip", req.ip ?? req.socket.remoteAddress ?? "unknown", 20);
  if (!authenticated) return undefined;
  const userId = req.session?.userId;
  if (typeof userId !== "number" || !Number.isSafeInteger(userId) || userId <= 0) {
    throw new PhoneRecoveryError(401, "Not authenticated.");
  }
  await enforceRecoveryRateLimit("user", String(userId), 10);
  return userId;
}

router.get(`${BASE}/phone`, async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  try {
    const result = await pool.query<{ phone_e164: string | null }>(
      `SELECT phone.phone_e164 FROM users citizen
       LEFT JOIN auth_recovery_phones phone ON phone.user_id = citizen.id
       WHERE citizen.id = $1 AND citizen.password_hash <> 'DELETED'
         AND EXISTS (SELECT 1 FROM user_sessions WHERE sid = $2
           AND sess->>'userId' = $1::text AND expire > NOW())`,
      [userId, req.sessionID],
    );
    if (!result.rowCount) throw new PhoneRecoveryError(401, "Not authenticated.");
    const phone = result.rows[0].phone_e164;
    res.json(GetRecoveryPhoneResponse.parse({
      hasVerifiedPhone: phone !== null, maskedPhone: phone ? maskRecoveryPhone(phone) : null,
    }));
  } catch (error) { replyError(req, res, error); }
});

router.post(`${BASE}/phone/bind`, mutationGuard, async (req, res): Promise<void> => {
  try {
    const userId = (await limitMutation(req, true))!;
    const parsed = BindRecoveryPhoneBody.strict().safeParse(req.body);
    if (!parsed.success || !parsed.data.currentPassword ||
      Buffer.byteLength(parsed.data.currentPassword, "utf8") > 1024) throw new PhoneRecoveryError(400);
    const proof = await verifyPhoneProof(parsed.data.idToken);
    await enforceRecoveryRateLimit("phone", proof.phone, 10);
    await recoveryTransaction(async client => {
      await lockRecoveryPhone(client, proof);
      const user = await requireRecoveryUser(client, userId, req.sessionID);
      // Compare while holding the user row lock, not against a pre-lock hash.
      await requireCurrentRecoveryPassword(parsed.data.currentPassword, user.password_hash);
      await consumeRecoveryProof(client, proof);
      await client.query(
        `INSERT INTO auth_recovery_phones
         (user_id, phone_e164, firebase_project_id, verified_auth_time, verified_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id) DO UPDATE SET phone_e164 = EXCLUDED.phone_e164,
           firebase_project_id = EXCLUDED.firebase_project_id,
           verified_auth_time = EXCLUDED.verified_auth_time, verified_at = NOW()`,
        [userId, proof.phone, proof.projectId, proof.authTime],
      );
      assertFreshPhoneProof(proof);
    });
    res.json(BindRecoveryPhoneResponse.parse({ hasVerifiedPhone: true, maskedPhone: maskRecoveryPhone(proof.phone) }));
  } catch (error) { replyError(req, res, error); }
});

router.post(`${BASE}/phone/remove`, mutationGuard, async (req, res): Promise<void> => {
  try {
    const userId = (await limitMutation(req, true))!;
    const parsed = RemoveRecoveryPhoneBody.strict().safeParse(req.body);
    if (!parsed.success || !parsed.data.currentPassword ||
      Buffer.byteLength(parsed.data.currentPassword, "utf8") > 1024) throw new PhoneRecoveryError(400);
    const proof = await verifyPhoneProof(parsed.data.idToken);
    await enforceRecoveryRateLimit("phone", proof.phone, 10);
    await recoveryTransaction(async client => {
      await lockRecoveryPhone(client, proof);
      const user = await requireRecoveryUser(client, userId, req.sessionID);
      await requireCurrentRecoveryPassword(parsed.data.currentPassword, user.password_hash);
      const mapping = await client.query(
        `SELECT user_id FROM auth_recovery_phones WHERE user_id = $1 AND phone_e164 = $2
         AND firebase_project_id = $3 AND verified_auth_time <= $4 FOR UPDATE`,
        [userId, proof.phone, proof.projectId, proof.authTime],
      );
      if (!mapping.rowCount) throw new PhoneRecoveryError(400);
      await consumeRecoveryProof(client, proof);
      await client.query("DELETE FROM auth_recovery_phones WHERE user_id = $1", [userId]);
      assertFreshPhoneProof(proof);
    });
    res.json(RemoveRecoveryPhoneResponse.parse({ hasVerifiedPhone: false, maskedPhone: null }));
  } catch (error) { replyError(req, res, error); }
});

router.post(`${BASE}/access`, mutationGuard, async (req, res): Promise<void> => {
  let rotatingSession = false;
  try {
    await limitMutation(req, false);
    const parsed = AccessRecoveryAccountBody.strict().safeParse(req.body);
    if (!parsed.success) throw new PhoneRecoveryError(400);
    const proof = await verifyPhoneProof(parsed.data.idToken);
    await enforceRecoveryRateLimit("phone", proof.phone, 10);
    const revoked = await recoveryTransaction(async client => {
      // Same lock order and durable proof ledger as password recovery.
      await client.query("SELECT pg_advisory_xact_lock(47201, 1)");
      await lockRecoveryPhone(client, proof);
      const found = await client.query<{ user_id: number }>(
        `SELECT user_id FROM auth_recovery_phones WHERE phone_e164 = $1 AND firebase_project_id = $2`,
        [proof.phone, proof.projectId],
      );
      const userId = found.rows[0]?.user_id;
      if (!userId) throw new PhoneRecoveryError(400);
      await requireRecoveryUser(client, userId);
      const mapping = await client.query(
        `SELECT user_id FROM auth_recovery_phones WHERE user_id = $1 AND phone_e164 = $2
         AND firebase_project_id = $3 AND verified_auth_time <= $4 FOR UPDATE`,
        [userId, proof.phone, proof.projectId, proof.authTime],
      );
      if (!mapping.rowCount) throw new PhoneRecoveryError(400);
      await consumeRecoveryProof(client, proof);
      // SMS grants access to this existing account; its password is unchanged.
      const changed = await client.query<{ credential_epoch: number }>(
        `UPDATE users SET credential_epoch = credential_epoch + 1
         WHERE id = $1 RETURNING credential_epoch`, [userId],
      );
      const credentialEpoch = changed.rows[0].credential_epoch;
      await client.query(
        `INSERT INTO auth_offline_recovery_revocations (user_id, credential_epoch)
         VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE
         SET credential_epoch = EXCLUDED.credential_epoch, created_at = NOW()`,
        [userId, credentialEpoch],
      );
      const sessions = await client.query<{ sid: string }>(
        `DELETE FROM user_sessions WHERE sess->>'userId' = $1::text RETURNING sid`, [userId],
      );
      await revokeRecoveryPushBindings(client, userId);
      // Match phone reset policy: retain recovery codes, E2EE registrations and
      // historical messages. This endpoint does not perform account erasure.
      assertFreshPhoneProof(proof);
      return { userId, credentialEpoch, sessionIds: sessions.rows.map(row => row.sid) };
    });
    for (const sid of revoked.sessionIds) disconnectSessionSockets(sid);
    disconnectUserSockets(revoked.userId);
    const firebaseRevoked = await completeOfflineRecoveryRevocation(revoked.userId);
    if (!firebaseRevoked) req.log.warn("Recovery succeeded; Firebase push mirror revocation pending");
    // Session persistence takes its own user SHARE lock: never save while the
    // recovery transaction holds the UPDATE lock. The captured epoch, not a
    // later snapshot, fences concurrent recovery/password changes at insertion.
    const previousSessionId = req.sessionID;
    const previousSessionUserId = req.session?.userId;
    rotatingSession = true;
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate(err => err ? reject(err) : resolve()),
    );
    disconnectSessionSockets(previousSessionId);
    if (previousSessionUserId && previousSessionUserId !== revoked.userId) {
      void revokeCallPushSession(previousSessionUserId, previousSessionId).catch(() => {});
    }
    req.session.userId = revoked.userId;
    authorizeNewSession(req.session, revoked.credentialEpoch);
    configureSessionLifetime(req.session);
    await new Promise<void>((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    res.json(AccessRecoveryAccountResponse.parse({ success: true }));
  } catch (error) {
    if (rotatingSession) {
      // A failed explicit save must not be retried implicitly at response end.
      req.session = null as unknown as typeof req.session;
      res.clearCookie("connect.sid", { path: "/", httpOnly: true, sameSite: "lax",
        secure: process.env.NODE_ENV === "production" });
    }
    replyError(req, res, error instanceof SessionRevokedError ? new PhoneRecoveryError(400) : error);
  }
});

router.post(`${BASE}/reset`, mutationGuard, async (req, res): Promise<void> => {
  try {
    await limitMutation(req, false);
    const parsed = ResetRecoveryPasswordBody.strict().safeParse(req.body);
    if (!parsed.success) throw new PhoneRecoveryError(400);
    if (!validRecoveryPassword(parsed.data.newPassword)) {
      throw new PhoneRecoveryError(400, "Password must have at least 6 characters and at most 72 UTF-8 bytes.");
    }
    const proof = await verifyPhoneProof(parsed.data.idToken);
    await enforceRecoveryRateLimit("phone", proof.phone, 10);
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    const revoked = await recoveryTransaction(async client => {
      // All credential reset paths use the same device/user lock order.
      await client.query("SELECT pg_advisory_xact_lock(47201, 1)");
      await lockRecoveryPhone(client, proof);
      // Account identity derives ONLY from an already bound verified phone.
      const found = await client.query<{ user_id: number }>(
        `SELECT user_id FROM auth_recovery_phones WHERE phone_e164 = $1 AND firebase_project_id = $2`,
        [proof.phone, proof.projectId],
      );
      const userId = found.rows[0]?.user_id;
      if (!userId) throw new PhoneRecoveryError(400);
      await requireRecoveryUser(client, userId);
      // Binding may have changed or been erased while waiting for the user row.
      const mapping = await client.query(
        `SELECT user_id FROM auth_recovery_phones WHERE user_id = $1 AND phone_e164 = $2
         AND firebase_project_id = $3 AND verified_auth_time <= $4 FOR UPDATE`,
        [userId, proof.phone, proof.projectId, proof.authTime],
      );
      if (!mapping.rowCount) throw new PhoneRecoveryError(400);
      await consumeRecoveryProof(client, proof);
      const changed = await client.query<{ credential_epoch: number }>(
        `UPDATE users SET password_hash = $1, credential_epoch = credential_epoch + 1
         WHERE id = $2 RETURNING credential_epoch`, [passwordHash, userId],
      );
      await client.query(
        `INSERT INTO auth_offline_recovery_revocations (user_id, credential_epoch)
         VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE
         SET credential_epoch = EXCLUDED.credential_epoch, created_at = NOW()`,
        [userId, changed.rows[0].credential_epoch],
      );
      const sessions = await client.query<{ sid: string }>(
        `DELETE FROM user_sessions WHERE sess->>'userId' = $1::text RETURNING sid`, [userId],
      );
      await revokeRecoveryPushBindings(client, userId);
      assertFreshPhoneProof(proof);
      return { userId, sessionIds: sessions.rows.map(row => row.sid) };
    });
    for (const sid of revoked.sessionIds) disconnectSessionSockets(sid);
    disconnectUserSockets(revoked.userId);
    const firebaseRevoked = await completeOfflineRecoveryRevocation(revoked.userId);
    if (!firebaseRevoked) req.log.warn("Recovery succeeded; Firebase push mirror revocation pending");
    // Do not regenerate, issue a replacement cookie, or auto-login.
    if (req.session?.userId === revoked.userId) {
      await new Promise<void>(resolve => req.session.destroy(() => resolve()));
      res.clearCookie("connect.sid", { path: "/", httpOnly: true, sameSite: "lax",
        secure: process.env.NODE_ENV === "production" });
    }
    res.json(ResetRecoveryPasswordResponse.parse({ success: true }));
  } catch (error) { replyError(req, res, error); }
});

export default router;
