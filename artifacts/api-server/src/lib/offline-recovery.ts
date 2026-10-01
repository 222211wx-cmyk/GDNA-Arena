import { createHash, createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import type { NextFunction, Request, Response } from "express";

export const RECOVERY_CODE_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;
const INVALID_PROOF = "The recovery code is invalid, expired or already used.";

export class OfflineRecoveryError extends Error {
  constructor(readonly status = 400, message = INVALID_PROOF) { super(message); }
}

export function newRecoveryCode(): string {
  return `GDNA-${randomBytes(32).toString("hex").toUpperCase().match(/.{8}/g)!.join("-")}`;
}

export function recoveryCodeDigest(code: string): string {
  // Formatting is not entropy. Accept pasted spaces/dashes and either case.
  const normalized = code.replace(/[\s-]/g, "").toUpperCase();
  if (!/^GDNA[0-9A-F]{64}$/.test(normalized)) throw new OfflineRecoveryError();
  return createHash("sha256").update(`offline-recovery-v1:${normalized}`).digest("hex");
}

export function validOfflineRecoveryPassword(value: string): boolean {
  return value.length >= 6 && Buffer.byteLength(value, "utf8") <= 72;
}

export async function offlineRecoveryTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

let nextLimitCleanup = 0;
const developmentLimitKey = randomBytes(32).toString("hex");
export async function limitOfflineRecovery(scope: "ip" | "user" | "code", subject: string, limit: number): Promise<void> {
  const key = process.env.SESSION_SECRET ?? developmentLimitKey;
  const digest = createHmac("sha256", key).update(`offline-recovery:${scope}:${subject}`).digest("hex");
  const result = await pool.query<{ attempts: number }>(
    `INSERT INTO auth_offline_recovery_limits (scope_digest, window_start, attempts)
     VALUES ($1, to_timestamp(floor(extract(epoch FROM clock_timestamp()) / 900) * 900), 1)
     ON CONFLICT (scope_digest, window_start)
     DO UPDATE SET attempts = auth_offline_recovery_limits.attempts + 1 RETURNING attempts`, [digest],
  );
  if (Date.now() > nextLimitCleanup) {
    nextLimitCleanup = Date.now() + 900_000;
    // Retain counters only beyond their enforcement window; no raw subjects.
    void pool.query("DELETE FROM auth_offline_recovery_limits WHERE window_start < NOW() - INTERVAL '2 days'")
      .catch(() => { /* cleanup failure must not bypass the counter above */ });
  }
  if (result.rows[0].attempts > limit) {
    throw new OfflineRecoveryError(429, "Too many attempts. Try again in 15 minutes.");
  }
}

export async function reverifyRecoveryOwner(client: PoolClient, req: Request, password: string): Promise<number> {
  const userId = req.session?.userId;
  if (typeof userId !== "number" || !Number.isSafeInteger(userId) || userId <= 0) throw new OfflineRecoveryError(401, "Not authenticated.");
  const found = await client.query<{ password_hash: string; credential_epoch: number }>(
    "SELECT password_hash, credential_epoch FROM users WHERE id = $1 FOR UPDATE", [userId],
  );
  const user = found.rows[0];
  if (!user || user.password_hash === "DELETED" ||
      user.credential_epoch !== (req.session.credentialEpoch ?? 0)) {
    throw new OfflineRecoveryError(401, "Not authenticated.");
  }
  // Lock the canonical session too: simultaneous logout must not revoke it
  // while an issuance transaction is committing.
  const session = await client.query(
    `SELECT sid FROM user_sessions WHERE sid = $1 AND sess->>'userId' = $2::text
     AND expire > NOW() FOR UPDATE`, [req.sessionID, userId],
  );
  if (!session.rowCount) throw new OfflineRecoveryError(401, "Not authenticated.");
  let matches = false;
  try { matches = await bcrypt.compare(password, user.password_hash); } catch { /* fail closed */ }
  if (!matches) throw new OfflineRecoveryError(403, "Current password is incorrect.");
  return userId;
}

export async function auditOfflineRecovery(client: PoolClient, userId: number, action: "issued" | "replaced" | "removed" | "redeemed"): Promise<void> {
  await client.query("INSERT INTO auth_offline_recovery_audit (user_id, action) VALUES ($1, $2)", [userId, action]);
}

export async function revokeOfflineRecoveryDevices(client: PoolClient, userId: number): Promise<string[]> {
  const sessions = await client.query<{ sid: string }>(
    "DELETE FROM user_sessions WHERE sess->>'userId' = $1::text RETURNING sid", [userId],
  );
  await client.query(
    `DELETE FROM browser_push_deliveries WHERE subscription_id IN
      (SELECT id FROM browser_push_subscriptions WHERE user_id = $1)`, [userId],
  );
  await client.query("DELETE FROM browser_push_subscriptions WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM expo_push_installations WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM native_call_push_installations WHERE user_id = $1", [userId]);
  // Public registrations only: never remove messages, room envelopes or any
  // client private key. Old ciphertext and offline private keys still exist.
  await client.query("DELETE FROM dm_user_e2ee_keys WHERE user_id = $1", [userId]);
  return sessions.rows.map(row => row.sid);
}

export function offlineRecoveryMutationGuard(req: Request, res: Response, next: NextFunction): void {
  const origins = new Set(["https://helixly.app", "https://www.helixly.app",
    "https://arena-qaisypro.com", "https://www.arena-qaisypro.com"]);
  for (const domain of [
    process.env.REPLIT_DEV_DOMAIN, process.env.REPLIT_EXPO_DEV_DOMAIN,
    ...(process.env.REPLIT_DOMAINS ?? "").split(","),
  ]) if (domain?.trim()) origins.add(`https://${domain.trim()}`);
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost");
    origins.add("http://localhost:80");
  }
  let trusted = false;
  try {
    const origin = req.get("origin");
    const referer = req.get("referer");
    trusted = origin ? origins.has(origin) && new URL(origin).origin === origin
      : referer ? origins.has(new URL(referer).origin)
      : !req.get("sec-fetch-site") || req.get("sec-fetch-site") === "same-origin";
  } catch { /* fail closed */ }
  if (!trusted) { res.status(403).json({ error: "Request origin is not allowed." }); return; }
  if (!req.is("application/json")) { res.status(400).json({ error: "A JSON request is required." }); return; }
  next();
}

export function replyOfflineRecoveryError(req: Request, res: Response, error: unknown): void {
  if (error instanceof OfflineRecoveryError) {
    if (error.status === 429) res.setHeader("Retry-After", "900");
    res.status(error.status).json({ error: error.message });
    return;
  }
  // SQL/driver errors may contain secrets in bound parameters. Never log them.
  req.log.warn("Offline account recovery operation unavailable");
  res.status(503).json({ error: "Account recovery is temporarily unavailable. Try again later." });
}