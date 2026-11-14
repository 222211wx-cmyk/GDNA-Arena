import { createHash } from "node:crypto";
import bcrypt from "bcrypt";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { asPublicConfig, hasFirebaseWebEmulatorConfiguration, type PublicFirebaseConfig } from "./firebase-call-push";

const MAX_PROOF_AGE_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 30;
const GENERIC_FAILURE = "Recovery could not be completed. Verify your phone again and retry.";
export const RECOVERY_UNAVAILABLE = "Phone recovery is temporarily unavailable.";

export class PhoneRecoveryError extends Error {
  constructor(public readonly status: 400 | 401 | 403 | 409 | 429 | 503, message = GENERIC_FAILURE) {
    super(message);
  }
}

export interface VerifiedPhoneProof {
  phone: string;
  projectId: string;
  authTime: number;
  eventDigest: string;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** The project pin comes ONLY from server-owned configuration, never the JWT
 * or request. No Admin/service-account credential is needed for verification.
 * configured describes local configuration, not console provider/billing readiness. */
export function recoveryFirebaseConfig(): PublicFirebaseConfig | null {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIREBASE_EMULATOR_HUB ||
    process.env.FIREBASE_EMULATOR_HUB_HOST || hasFirebaseWebEmulatorConfiguration()) return null;
  const config = asPublicConfig();
  if (!config || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.projectId) ||
    config.projectId.startsWith("demo-")) return null;
  // Reject URLs, ports, IPs, localhost and local-only domains. Firebase accepts
  // real custom auth domains too; don't force a fabricated firebaseapp.com URL.
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(config.authDomain) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(config.authDomain)) return null;
  return config;
}

export function assertFreshPhoneProof(proof: VerifiedPhoneProof): void {
  const now = Math.floor(Date.now() / 1000);
  if (proof.authTime > now + CLOCK_SKEW_SECONDS || now - proof.authTime > MAX_PROOF_AGE_SECONDS) {
    throw new PhoneRecoveryError(400);
  }
}

export async function verifyPhoneProof(token: string): Promise<VerifiedPhoneProof> {
  const config = recoveryFirebaseConfig();
  if (!config) throw new PhoneRecoveryError(503, RECOVERY_UNAVAILABLE);
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[2]) throw new PhoneRecoveryError(400);
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Record<string, unknown>;
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
      throw new PhoneRecoveryError(400);
    }
    const appName = `gdna-phone-recovery-verifier-${config.projectId}`;
    const app = getApps().find(candidate => candidate.name === appName) ??
      initializeApp({ projectId: config.projectId }, appName);
    if (app.options.projectId !== config.projectId) throw new PhoneRecoveryError(503, RECOVERY_UNAVAILABLE);
    // false is intentional: signature/issuer/audience verification works with
    // public Google certificates; revocation lookup would require a credential.
    const decoded = await getAuth(app).verifyIdToken(token, false);
    const now = Math.floor(Date.now() / 1000);
    if (decoded.aud !== config.projectId || decoded.iss !== `https://securetoken.google.com/${config.projectId}` ||
      decoded.firebase?.sign_in_provider !== "phone" || decoded.firebase?.tenant ||
      typeof decoded.sub !== "string" || !decoded.sub || decoded.uid !== decoded.sub ||
      typeof decoded.phone_number !== "string" || !/^\+[1-9][0-9]{1,14}$/.test(decoded.phone_number) ||
      !Number.isSafeInteger(decoded.auth_time) || decoded.auth_time <= 0 ||
      !Number.isSafeInteger(decoded.iat) || decoded.iat > now + CLOCK_SKEW_SECONDS ||
      decoded.auth_time > decoded.iat) throw new PhoneRecoveryError(400);
    const proof = {
      phone: decoded.phone_number,
      projectId: config.projectId,
      authTime: decoded.auth_time,
      // Refreshing an ID token changes iat/signature, NOT the auth event.
      eventDigest: digest([config.projectId, decoded.sub, decoded.auth_time]),
    };
    assertFreshPhoneProof(proof);
    return proof;
  } catch (error) {
    if (error instanceof PhoneRecoveryError) throw error;
    const code = (error as { code?: unknown })?.code;
    if (code === "auth/internal-error" || code === "app/network-error" || code === "app/network-timeout") {
      throw new PhoneRecoveryError(503, RECOVERY_UNAVAILABLE);
    }
    // Never expose Firebase exceptions: they can contain token fragments.
    throw new PhoneRecoveryError(400);
  }
}

/** Shared PostgreSQL counters count successes too; retries on any replica or
 * a restarted process cannot bypass recovery's IP/account/phone shields. */
export async function enforceRecoveryRateLimit(scope: "ip" | "user" | "phone", subject: string, limit: number): Promise<void> {
  const result = await pool.query<{ attempts: number }>(
    `INSERT INTO auth_recovery_rate_limits (scope_digest, window_start, attempts)
     VALUES ($1, to_timestamp(floor(extract(epoch FROM clock_timestamp()) / 900) * 900), 1)
     ON CONFLICT (scope_digest, window_start) DO UPDATE
     SET attempts = LEAST(auth_recovery_rate_limits.attempts + 1, $2::integer + 1)
     RETURNING attempts`,
    [digest(["phone-recovery-v1", scope, subject]), limit],
  );
  if (result.rows[0].attempts > limit) throw new PhoneRecoveryError(429, "Too many recovery attempts. Try again in 15 minutes.");
}

export async function recoveryTransaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Always phone advisory lock -> user row -> mapping row; reset discovers its
 * user without a mapping row lock then rechecks after acquiring the user lock. */
export async function lockRecoveryPhone(client: PoolClient, proof: VerifiedPhoneProof): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    digest(["phone-recovery-lock", proof.phone]),
  ]);
}

export async function consumeRecoveryProof(client: PoolClient, proof: VerifiedPhoneProof): Promise<void> {
  assertFreshPhoneProof(proof);
  const consumed = await client.query(
    `INSERT INTO auth_recovery_proofs (event_digest) VALUES ($1)
     ON CONFLICT DO NOTHING RETURNING event_digest`,
    [proof.eventDigest],
  );
  if (!consumed.rowCount) throw new PhoneRecoveryError(400);
}

export async function requireRecoveryUser(client: PoolClient, userId: number, sessionId?: string): Promise<{ id: number; password_hash: string }> {
  const result = await client.query<{ id: number; password_hash: string }>(
    `SELECT id, password_hash FROM users WHERE id = $1 FOR UPDATE`, [userId],
  );
  const user = result.rows[0];
  if (!user || user.password_hash === "DELETED") throw new PhoneRecoveryError(sessionId ? 401 : 400);
  if (sessionId) {
    const live = await client.query(
      `SELECT sid FROM user_sessions WHERE sid = $1 AND sess->>'userId' = $2::text AND expire > NOW()`,
      [sessionId, userId],
    );
    if (!live.rowCount) throw new PhoneRecoveryError(401, "Not authenticated.");
  }
  return user;
}

export async function requireCurrentRecoveryPassword(password: string, hash: string): Promise<void> {
  let valid = false;
  try { valid = await bcrypt.compare(password, hash); } catch { /* malformed legacy hash fails closed */ }
  if (!valid) throw new PhoneRecoveryError(400, "Current password or phone verification is invalid.");
}

/** Uses the current app's six-character minimum, with bcrypt's actual byte
 * bound enforced so passwords cannot silently collide after truncation. */
export function validRecoveryPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 6 && Buffer.byteLength(value, "utf8") <= 72;
}

export function maskRecoveryPhone(phone: string): string {
  if (phone.length < 6) return "+••";
  return `+${"•".repeat(phone.length - 5)}${phone.slice(-4)}`;
}

/** Local app push bindings are deleted in the credential transaction. Firebase
 * mirrors are revoked afterwards through the existing change-password helper. */
export async function revokeRecoveryPushBindings(client: PoolClient, userId: number): Promise<void> {
  await client.query(
    `DELETE FROM browser_push_deliveries WHERE subscription_id IN
     (SELECT id FROM browser_push_subscriptions WHERE user_id = $1)`, [userId],
  );
  await client.query("DELETE FROM browser_push_subscriptions WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM expo_push_installations WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM native_call_push_installations WHERE user_id = $1", [userId]);
}
