import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcrypt";
import { pool } from "@workspace/db";
import { GenerateRecoveryCodeBody, RemoveRecoveryCodeBody, RedeemRecoveryCodeBody } from "@workspace/api-zod";
import { disconnectSessionSockets, disconnectUserSockets } from "../lib/signaling";
import { completeOfflineRecoveryRevocation } from "../lib/offline-recovery-revocation";
import {
  RECOVERY_CODE_LIFETIME_MS, OfflineRecoveryError, auditOfflineRecovery,
  limitOfflineRecovery, newRecoveryCode, offlineRecoveryMutationGuard,
  offlineRecoveryTransaction, recoveryCodeDigest, replyOfflineRecoveryError,
  reverifyRecoveryOwner, revokeOfflineRecoveryDevices, validOfflineRecoveryPassword,
} from "../lib/offline-recovery";

const router: IRouter = Router();
const BASE = "/auth/recovery-code";
router.use(BASE, (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
  next();
});
router.use(BASE, rateLimit({
  windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests. Try again later." },
}));

router.get(`${BASE}/status`, async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) throw new OfflineRecoveryError(401, "Not authenticated.");
    const status = await pool.query<{ expires_at: Date | null }>(
      `SELECT code.expires_at FROM users citizen
       LEFT JOIN auth_offline_recovery_codes code ON code.user_id = citizen.id AND code.expires_at > NOW()
       WHERE citizen.id = $1 AND citizen.password_hash <> 'DELETED' AND citizen.credential_epoch = $3
       AND EXISTS (SELECT 1 FROM user_sessions WHERE sid = $2 AND sess->>'userId' = $1::text AND expire > NOW())`,
      [userId, req.sessionID, req.session.credentialEpoch ?? 0],
    );
    if (!status.rowCount) throw new OfflineRecoveryError(401, "Not authenticated.");
    const expiresAt = status.rows[0].expires_at;
    res.json({ active: expiresAt !== null, expiresAt: expiresAt?.toISOString() ?? null });
  } catch (error) { replyOfflineRecoveryError(req, res, error); }
});

for (const operation of ["generate", "remove"] as const) {
  router.post(`${BASE}/${operation}`, offlineRecoveryMutationGuard, async (req, res): Promise<void> => {
    try {
      await limitOfflineRecovery("ip", req.ip ?? req.socket.remoteAddress ?? "unknown", 20);
      if (!req.session?.userId) throw new OfflineRecoveryError(401, "Not authenticated.");
      await limitOfflineRecovery("user", String(req.session.userId), 10);
      const parsed = (operation === "generate" ? GenerateRecoveryCodeBody : RemoveRecoveryCodeBody).safeParse(req.body);
      if (!parsed.success || Buffer.byteLength(parsed.data.currentPassword, "utf8") > 1024) {
        throw new OfflineRecoveryError(400, "A current password is required.");
      }
      const result = await offlineRecoveryTransaction(async client => {
        const userId = await reverifyRecoveryOwner(client, req, parsed.data.currentPassword);
        if (operation === "remove") {
          await client.query("DELETE FROM auth_offline_recovery_codes WHERE user_id = $1", [userId]);
          await auditOfflineRecovery(client, userId, "removed");
          return { active: false, expiresAt: null };
        }
        const previous = await client.query("SELECT user_id FROM auth_offline_recovery_codes WHERE user_id = $1", [userId]);
        const code = newRecoveryCode();
        const expiresAt = new Date(Date.now() + RECOVERY_CODE_LIFETIME_MS);
        await client.query(
          `INSERT INTO auth_offline_recovery_codes (user_id, code_digest, expires_at)
           VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE
           SET code_digest = EXCLUDED.code_digest, expires_at = EXCLUDED.expires_at, created_at = NOW()`,
          [userId, recoveryCodeDigest(code), expiresAt],
        );
        await auditOfflineRecovery(client, userId, previous.rowCount ? "replaced" : "issued");
        return { code, expiresAt: expiresAt.toISOString() };
      });
      res.json(result);
    } catch (error) { replyOfflineRecoveryError(req, res, error); }
  });
}

router.post(`${BASE}/reset`, offlineRecoveryMutationGuard, async (req, res): Promise<void> => {
  try {
    await limitOfflineRecovery("ip", req.ip ?? req.socket.remoteAddress ?? "unknown", 20);
    const parsed = RedeemRecoveryCodeBody.safeParse(req.body);
    if (!parsed.success || !validOfflineRecoveryPassword(parsed.data.newPassword)) throw new OfflineRecoveryError();
    const digest = recoveryCodeDigest(parsed.data.code);
    await limitOfflineRecovery("code", digest, 5);
    // Apply the same expensive hash work to every syntactically valid proof,
    // whether it exists or not. Identity comes only from the secret digest.
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    const revoked = await offlineRecoveryTransaction(async client => {
      // Same lock/order as encrypted-send and secure-device enrollment. No
      // deleted old public key can be used in a simultaneously inserted message.
      await client.query("SELECT pg_advisory_xact_lock(47201, 1)");
      const found = await client.query<{ user_id: number }>(
        "SELECT user_id FROM auth_offline_recovery_codes WHERE code_digest = $1", [digest],
      );
      const userId = found.rows[0]?.user_id;
      if (!userId) throw new OfflineRecoveryError();
      const citizen = await client.query<{ username: string; password_hash: string }>(
        "SELECT username, password_hash FROM users WHERE id = $1 FOR UPDATE", [userId],
      );
      if (!citizen.rowCount || citizen.rows[0].password_hash === "DELETED") throw new OfflineRecoveryError();
      // Recheck and consume AFTER taking user lock: rotate/remove/other reset
      // cannot invalidate a previously read proof then let it redeem anyway.
      const consumed = await client.query(
        `DELETE FROM auth_offline_recovery_codes WHERE user_id = $1 AND code_digest = $2
         AND expires_at > clock_timestamp() RETURNING user_id`, [userId, digest],
      );
      if (!consumed.rowCount) throw new OfflineRecoveryError();
      const changed = await client.query<{ credential_epoch: number }>(
        `UPDATE users SET password_hash = $1, credential_epoch = credential_epoch + 1
         WHERE id = $2 RETURNING credential_epoch`, [passwordHash, userId],
      );
      const sessionIds = await revokeOfflineRecoveryDevices(client, userId);
      await client.query(
        `INSERT INTO auth_offline_recovery_revocations (user_id, credential_epoch)
         VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE
         SET credential_epoch = EXCLUDED.credential_epoch, created_at = NOW()`,
        [userId, changed.rows[0].credential_epoch],
      );
      await auditOfflineRecovery(client, userId, "redeemed");
      return { userId, username: citizen.rows[0].username, sessionIds };
    });
    for (const sid of revoked.sessionIds) disconnectSessionSockets(sid);
    disconnectUserSockets(revoked.userId);
    const providerRevoked = await completeOfflineRecoveryRevocation(revoked.userId);
    // A durable worker completes external-provider cleanup. Local access and
    // new provider enrollment are fenced immediately by the credential epoch.
    if (req.session?.userId === revoked.userId) {
      await new Promise<void>(resolve => req.session.destroy(() => resolve()));
      res.clearCookie("connect.sid", { path: "/", httpOnly: true, sameSite: "lax",
        secure: process.env.NODE_ENV === "production" });
    }
    res.json({ success: true, username: revoked.username, revocationPending: !providerRevoked });
  } catch (error) { replyOfflineRecoveryError(req, res, error); }
});

export default router;