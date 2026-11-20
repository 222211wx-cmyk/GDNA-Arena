import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { pool as nullablePool } from "@workspace/db";
import { getSmsProvider } from "./sms";
import { OtpChannel, channelEnabled, deliverOtp, isOtpChannel } from "./otp-channels";

const pool = nullablePool!;

export class AuthError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_HOUR = 6;
export const DEVICE_COOKIE = "gdna_device";
export const DEVICE_TTL_MS = 400 * 24 * 60 * 60 * 1000;

export const authSchemaReady: Promise<void> = pool.query(`
  CREATE TABLE IF NOT EXISTS auth_profiles (
    user_id       integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email         text,
    display_name  text,
    avatar_url    text,
    phone_e164    text,
    phone_verified boolean NOT NULL DEFAULT false,
    google_sub    text,
    created_at    timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS auth_profiles_email_uniq ON auth_profiles (LOWER(email)) WHERE email IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS auth_profiles_google_uniq ON auth_profiles (google_sub) WHERE google_sub IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS auth_profiles_phone_uniq ON auth_profiles (phone_e164) WHERE phone_verified;
  CREATE TABLE IF NOT EXISTS auth_trusted_devices (
    id         serial PRIMARY KEY,
    user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL,
    label      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, token_hash)
  );
  CREATE TABLE IF NOT EXISTS auth_otps (
    id          text PRIMARY KEY,
    purpose     text NOT NULL,
    user_id     integer,
    phone_e164  text NOT NULL,
    code_hash   text NOT NULL,
    attempts    integer NOT NULL DEFAULT 0,
    consumed    boolean NOT NULL DEFAULT false,
    verified_token_hash text,
    expires_at  timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS auth_otps_phone_idx ON auth_otps (phone_e164, purpose, created_at);
  ALTER TABLE auth_otps ADD COLUMN IF NOT EXISTS channel text, ADD COLUMN IF NOT EXISTS destination text, ADD COLUMN IF NOT EXISTS sent_at timestamptz;
  CREATE TABLE IF NOT EXISTS auth_pending_citizens (
    challenge_id  text PRIMARY KEY,
    email         text NOT NULL,
    display_name  text NOT NULL,
    password_hash text NOT NULL,
    phone_e164    text,
    birth_date    text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS auth_pending_citizens_email_idx ON auth_pending_citizens (LOWER(email));
`).then(() => undefined);

const secret = () => process.env.SESSION_SECRET ?? "gdna-arena-dev-secret";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const hmac = (v: string) => createHmac("sha256", secret()).update(v).digest("hex");
const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(v) ? v : null;
}

export function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)}${"•".repeat(Math.max(phone.length - 7, 2))}${phone.slice(-3)}`;
}

export interface Profile {
  email: string | null; displayName: string | null; avatarUrl: string | null;
  phone: string | null; phoneVerified: boolean; hasGoogle: boolean;
}

export async function getProfile(userId: number): Promise<Profile> {
  const r = await pool.query(
    `SELECT p.email, p.display_name, p.avatar_url, p.phone_e164, p.phone_verified, p.google_sub,
            rp.phone_e164 AS legacy_phone
     FROM users u LEFT JOIN auth_profiles p ON p.user_id = u.id
     LEFT JOIN auth_recovery_phones rp ON rp.user_id = u.id WHERE u.id = $1`, [userId],
  ).catch(() => pool.query(
    `SELECT p.email, p.display_name, p.avatar_url, p.phone_e164, p.phone_verified, p.google_sub, NULL AS legacy_phone
     FROM users u LEFT JOIN auth_profiles p ON p.user_id = u.id WHERE u.id = $1`, [userId]));
  const row = r.rows[0] ?? {};
  const phone = row.phone_verified ? row.phone_e164 : row.legacy_phone ?? null;
  return {
    email: row.email ?? null, displayName: row.display_name ?? null, avatarUrl: row.avatar_url ?? null,
    phone: phone ?? null, phoneVerified: !!phone, hasGoogle: !!row.google_sub,
  };
}

/** Verified phone (own or legacy Firebase-bound) usable for SMS to this user. */
export async function userVerifiedPhone(userId: number): Promise<string | null> {
  return (await getProfile(userId)).phone;
}

export async function findUserIdByVerifiedPhone(phone: string): Promise<number | null> {
  const r = await pool.query(`SELECT user_id FROM auth_profiles WHERE phone_e164 = $1 AND phone_verified`, [phone]);
  if (r.rows[0]) return r.rows[0].user_id;
  const legacy = await pool.query(`SELECT user_id FROM auth_recovery_phones WHERE phone_e164 = $1`, [phone]).catch(() => null);
  return legacy?.rows[0]?.user_id ?? null;
}

/** Create + send an OTP. Enforces the 60s resend gap and an hourly cap per phone. */
export async function issueOtp(purpose: string, phone: string, userId: number | null, deliver = true): Promise<{ id: string; resendIn: number }> {
  const provider = getSmsProvider();
  if (!provider) throw new AuthError(503, "SMS_UNAVAILABLE");
  const recent = await pool.query(
    `SELECT created_at FROM auth_otps WHERE phone_e164 = $1 AND created_at > now() - interval '1 hour' AND purpose <> 'reset-token' ORDER BY created_at DESC`, [phone]);
  const sameKind = await pool.query(
    `SELECT created_at FROM auth_otps WHERE phone_e164 = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1`, [phone, purpose]);
  if (sameKind.rows[0] && Date.now() - new Date(sameKind.rows[0].created_at).getTime() < OTP_RESEND_MS) {
    throw new AuthError(429, "OTP_TOO_SOON");
  }
  if (recent.rowCount! >= OTP_MAX_PER_HOUR) throw new AuthError(429, "OTP_LIMIT");
  const id = randomBytes(16).toString("hex");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await pool.query(
    `INSERT INTO auth_otps (id, purpose, user_id, phone_e164, code_hash, expires_at, sent_at)
     VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' milliseconds')::interval, now())`,
    [id, purpose, userId, phone, hmac(`${id}:${code}`), String(OTP_TTL_MS)],
  );
  if (deliver) {
    try { await provider.send(phone, `GDNA Arena: ${code}`); }
    catch { throw new AuthError(502, "SMS_FAILED"); }
  }
  return { id, resendIn: OTP_RESEND_MS / 1000 };
}

/** Opens a challenge with no code sent yet. The user picks a channel later via sendChallengeCode. */
export async function openChallenge(purpose: string, key: string, userId: number | null): Promise<string> {
  const id = randomBytes(16).toString("hex");
  await pool.query(
    `INSERT INTO auth_otps (id, purpose, user_id, phone_e164, code_hash, expires_at)
     VALUES ($1,$2,$3,$4,'-', now() + ($5 || ' milliseconds')::interval)`,
    [id, purpose, userId, key, String(OTP_TTL_MS)],
  );
  return id;
}

/**
 * Generates a fresh code and sends it over the channel the user picked right now.
 * Each send replaces the previous code. Resends are at least OTP_RESEND_MS apart.
 */
export async function sendChallengeCode(id: string, purpose: string, channel: OtpChannel, destination: string): Promise<{ resendIn: number }> {
  const r = await pool.query(`SELECT * FROM auth_otps WHERE id = $1 AND purpose = $2`, [id, purpose]);
  const row = r.rows[0];
  if (!row || row.consumed || new Date(row.expires_at).getTime() < Date.now()) throw new AuthError(400, "OTP_EXPIRED");
  if (!channelEnabled(channel)) throw new AuthError(503, "CHANNEL_UNAVAILABLE");
  if (row.sent_at && Date.now() - new Date(row.sent_at).getTime() < OTP_RESEND_MS) throw new AuthError(429, "OTP_TOO_SOON");
  if (!row.sent_at) {
    const sent = await pool.query(
      `SELECT count(*)::int AS n FROM auth_otps WHERE phone_e164 = $1 AND purpose = $2 AND sent_at > now() - interval '1 hour'`,
      [row.phone_e164, purpose]);
    if (sent.rows[0].n >= OTP_MAX_PER_HOUR) throw new AuthError(429, "OTP_LIMIT");
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await pool.query(
    `UPDATE auth_otps SET code_hash = $2, channel = $3, destination = $4, sent_at = now() WHERE id = $1`,
    [id, hmac(`${id}:${code}`), channel, destination],
  );
  try { await deliverOtp(channel, destination, code); }
  catch { throw new AuthError(502, "DELIVERY_FAILED"); }
  return { resendIn: OTP_RESEND_MS / 1000 };
}

/** Contact details for an account, taken from the server only. The client never sends an address. */
export async function accountDestinations(userId: number): Promise<{ phone: string | null; email: string | null }> {
  const p = await getProfile(userId);
  return { phone: p.phone, email: p.email };
}

export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}${"•".repeat(Math.max(name.length - 1, 2))}@${domain ?? ""}`;
}

/** The channels this account can receive a code on right now. */
export function channelOptions(dest: { phone: string | null; email: string | null }): Array<{ channel: OtpChannel; masked: string }> {
  const out: Array<{ channel: OtpChannel; masked: string }> = [];
  if (dest.phone) {
    if (channelEnabled("sms")) out.push({ channel: "sms", masked: maskPhone(dest.phone) });
    if (channelEnabled("whatsapp")) out.push({ channel: "whatsapp", masked: maskPhone(dest.phone) });
  }
  if (dest.email && channelEnabled("email")) out.push({ channel: "email", masked: maskEmail(dest.email) });
  return out;
}

/** Where a chosen channel delivers. Throws when the account has no address for it. */
export function resolveChannel(channel: unknown, dest: { phone: string | null; email: string | null }): { channel: OtpChannel; destination: string } {
  if (!isOtpChannel(channel)) throw new AuthError(400, "CHANNEL_INVALID");
  const destination = channel === "email" ? dest.email : dest.phone;
  if (!destination) throw new AuthError(400, "CHANNEL_INVALID");
  return { channel, destination };
}

/** A decoy challenge id for unknown phones, so forgot-password never reveals who is registered. */
export function decoyChallenge() {
  return { id: randomBytes(16).toString("hex"), resendIn: OTP_RESEND_MS / 1000 };
}

export async function checkOtp(id: unknown, code: unknown, purpose: string): Promise<{ userId: number | null; phone: string }> {
  if (typeof id !== "string" || typeof code !== "string" || !/^\d{6}$/.test(code)) throw new AuthError(400, "OTP_INVALID");
  const r = await pool.query(`SELECT * FROM auth_otps WHERE id = $1 AND purpose = $2`, [id, purpose]);
  const row = r.rows[0];
  if (!row || row.consumed || !row.sent_at || new Date(row.expires_at).getTime() < Date.now()) throw new AuthError(400, "OTP_EXPIRED");
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw new AuthError(429, "OTP_ATTEMPTS");
  await pool.query(`UPDATE auth_otps SET attempts = attempts + 1 WHERE id = $1`, [id]);
  if (!safeEq(row.code_hash, hmac(`${id}:${code}`))) throw new AuthError(400, "OTP_INVALID");
  await pool.query(`UPDATE auth_otps SET consumed = true WHERE id = $1`, [id]);
  return { userId: row.user_id, phone: row.phone_e164 };
}

/** After a forgot-password OTP: mint a single-use reset token bound to the user. */
export async function mintResetToken(userId: number, phone: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await pool.query(
    `INSERT INTO auth_otps (id, purpose, user_id, phone_e164, code_hash, verified_token_hash, expires_at)
     VALUES ($1,'reset-token',$2,$3,'-',$4, now() + interval '15 minutes')`,
    [randomBytes(16).toString("hex"), userId, phone, sha(token)],
  );
  return token;
}

export async function consumeResetToken(token: unknown): Promise<number> {
  if (typeof token !== "string" || token.length < 20) throw new AuthError(400, "RESET_INVALID");
  const r = await pool.query(
    `UPDATE auth_otps SET consumed = true
     WHERE purpose='reset-token' AND verified_token_hash=$1 AND NOT consumed AND expires_at > now()
     RETURNING user_id`, [sha(token)]);
  if (!r.rows[0]) throw new AuthError(400, "RESET_INVALID");
  return r.rows[0].user_id;
}

// ── Device trust ─────────────────────────────────────────────
export async function isTrustedDevice(userId: number, token: string | undefined): Promise<boolean> {
  if (!token || token.length < 20) return false;
  const r = await pool.query(
    `UPDATE auth_trusted_devices SET last_seen_at = now() WHERE user_id=$1 AND token_hash=$2 RETURNING id`, [userId, sha(token)]);
  return !!r.rowCount;
}

/** Returns the raw token to set as a cookie (reuses the existing one when given). */
export async function trustDevice(userId: number, existing: string | undefined, label: string): Promise<string> {
  const token = existing && existing.length >= 20 ? existing : randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO auth_trusted_devices (user_id, token_hash, label) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, token_hash) DO UPDATE SET last_seen_at = now()`,
    [userId, sha(token), label.slice(0, 120)]);
  return token;
}
