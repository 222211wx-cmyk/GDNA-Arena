import { OTP_CHANNELS, channelEnabled, sendResetEmail } from "../lib/otp-channels";
import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, usersTable, pool as nullablePool } from "@workspace/db";
import { disconnectSessionSockets, disconnectUserSockets } from "../lib/signaling";
import { normalizeBirthDate } from "../lib/age";
import { configureSessionLifetime } from "../lib/session-policy";
import { authorizeNewSession } from "../lib/session-security";
import { revokeCallPushSession } from "../lib/firebase-call-push";
import { revokeRecoveryPushBindings } from "../lib/phone-recovery";
import { completeOfflineRecoveryRevocation } from "../lib/offline-recovery-revocation";
import { hasBlockedKeyword } from "../lib/moderate";
import { getSmsProvider, mockOutbox, smsIsReal } from "../lib/sms";
import {
  AuthError, DEVICE_COOKIE, DEVICE_TTL_MS, accountDestinations, authSchemaReady, channelOptions, checkOtp,
  consumeResetToken, decoyChallenge, findUserIdByVerifiedPhone, isTrustedDevice, issueOtp, maskPhone,
  mintResetToken, normalizePhone, openChallenge, resolveChannel, sendChallengeCode, trustDevice,
} from "../lib/auth-store";
import { serializeWithProfile } from "./auth";
import { DEVELOPER_PARTICLE, createBaselineArchonSession, developerSchemaReady } from "../lib/developer-registration";

const pool = nullablePool!;
const router: IRouter = Router();
const BASE = "/auth/v2";
const prod = () => process.env.NODE_ENV === "production";
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

router.use(BASE, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.use(BASE, (_req, _res, next) => { authSchemaReady.then(() => next(), next); });

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

function setDeviceCookie(res: Response, token: string) {
  res.cookie(DEVICE_COOKIE, token, {
    path: "/", httpOnly: true, sameSite: "lax", secure: prod(), maxAge: DEVICE_TTL_MS,
  });
}

const deviceLabel = (req: Request) => (req.get("user-agent") ?? "unknown").slice(0, 120);

async function startSession(req: Request, res: Response, userId: number, credentialEpoch: number, rememberMe: boolean) {
  const previousSessionId = req.sessionID;
  const previousUserId = req.session.userId;
  await new Promise<void>((ok, bad) => req.session.regenerate(e => (e ? bad(e) : ok())));
  disconnectSessionSockets(previousSessionId);
  if (previousUserId) void revokeCallPushSession(previousUserId, previousSessionId).catch(() => {});
  req.session.userId = userId;
  authorizeNewSession(req.session, credentialEpoch);
  configureSessionLifetime(req.session, rememberMe);
  await new Promise<void>((ok, bad) => req.session.save(e => (e ? bad(e) : ok())));
}

async function loadUser(userId: number) {
  const r = await db.select({ user: usersTable, credentialEpoch: sql<number>`credential_epoch` })
    .from(usersTable).where(sql`${usersTable.id} = ${userId}`).limit(1);
  return r[0];
}

async function respondLoggedIn(req: Request, res: Response, userId: number, rememberMe: boolean, status = 200) {
  const row = await loadUser(userId);
  if (!row) throw new AuthError(401, "INVALID_CREDENTIALS");
  await startSession(req, res, userId, row.credentialEpoch, rememberMe);
  const device = await trustDevice(userId, readCookie(req, DEVICE_COOKIE), deviceLabel(req));
  setDeviceCookie(res, device);
  res.status(status).json({ status: "ok", user: await serializeWithProfile(row.user) });
}


function fail(req: Request, res: Response, err: unknown) {
  if (err instanceof AuthError) { res.status(err.status).json({ error: err.code, code: err.code }); return; }
  req.log.error(err, "auth v2 error");
  res.status(500).json({ error: "SERVER_ERROR", code: "SERVER_ERROR" });
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const passwordOk = (v: unknown): v is string => typeof v === "string" && v.length >= 8 && Buffer.byteLength(v) <= 72;

async function uniqueUsername(base: string): Promise<string> {
  let clean = base.normalize("NFKD").replace(/[^\p{L}\p{N}_]+/gu, "").slice(0, 14);
  if (clean.length < 3 || hasBlockedKeyword(clean)) clean = `citizen${clean}`.slice(0, 14);
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? clean : `${clean}${randomBytes(2).toString("hex")}`.slice(0, 20);
    const r = await pool.query(`SELECT 1 FROM users WHERE LOWER(username)=LOWER($1)`, [candidate]);
    if (!r.rowCount) return candidate;
  }
  return `citizen${randomBytes(6).toString("hex")}`;
}

// ── Public config (drives which buttons the UI shows) ───────
router.get(`${BASE}/config`, (_req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? null,
    googleMock: !prod() && process.env.AUTH_MOCK_GOOGLE === "1",
    sms: getSmsProvider() !== null,
    smsProvider: getSmsProvider()?.name ?? null,
    smsReal: smsIsReal(),
    // Only channels that can really deliver. WhatsApp and Email appear once their keys are set.
    channels: OTP_CHANNELS.filter(channelEnabled),
  });
});

// ── Sign up with email: the account is created only after a code is verified ──
// The user picks SMS, WhatsApp or Email on every send. Nothing is remembered.
router.post(`${BASE}/signup`, async (req, res) => {
  try {
    await developerSchemaReady();
    const name = str(req.body?.name, 40);
    const email = str(req.body?.email, 254).toLowerCase();
    const password = req.body?.password;
    const phoneRaw = str(req.body?.phone, 30);
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
    const birthDate = normalizeBirthDate(req.body?.birthDate);
    if (name.length < 2) throw new AuthError(400, "NAME_INVALID");
    if (!EMAIL_RE.test(email)) throw new AuthError(400, "EMAIL_INVALID");
    if (!passwordOk(password)) throw new AuthError(400, "PASSWORD_WEAK");
    if (phoneRaw && !phone) throw new AuthError(400, "PHONE_INVALID");
    if (!birthDate) throw new AuthError(400, "BIRTHDATE_INVALID");
    if (hasBlockedKeyword(name)) throw new AuthError(400, "NAME_INVALID");
    if (!channelOptions({ phone, email }).length) throw new AuthError(503, "CHANNEL_UNAVAILABLE");

    const taken = await pool.query(
      `SELECT 1 FROM users WHERE LOWER(email)=$1 UNION SELECT 1 FROM auth_profiles WHERE LOWER(email)=$1`, [email]);
    if (taken.rowCount) throw new AuthError(409, "EMAIL_TAKEN");

    const passwordHash = await bcrypt.hash(password, 10);
    const challengeId = await openChallenge("signup", phone ?? email, null);
    await pool.query(`DELETE FROM auth_pending_citizens WHERE LOWER(email)=$1 OR created_at < now() - interval '${PENDING_TTL}'`, [email]);
    await pool.query(
      `INSERT INTO auth_pending_citizens (challenge_id, email, display_name, password_hash, phone_e164, birth_date) VALUES ($1,$2,$3,$4,$5,$6)`,
      [challengeId, email, name, passwordHash, phone, birthDate]);
    res.json({ challengeId, channels: channelOptions({ phone, email }) });
  } catch (e) { fail(req, res, e); }
});

async function pendingCitizen(challengeId: string) {
  const r = await pool.query(
    `SELECT * FROM auth_pending_citizens WHERE challenge_id=$1 AND created_at > now() - interval '${PENDING_TTL}'`, [challengeId]);
  if (!r.rows[0]) throw new AuthError(400, "OTP_EXPIRED");
  return r.rows[0];
}

const signupSend = async (req: Request, res: Response) => {
  try {
    await developerSchemaReady();
    const challengeId = str(req.body?.challengeId, 64);
    const p = await pendingCitizen(challengeId);
    const { channel, destination } = resolveChannel(req.body?.channel, { phone: p.phone_e164, email: p.email });
    const c = await sendChallengeCode(challengeId, "signup", channel, destination);
    res.json({ challengeId, channel, resendIn: c.resendIn });
  } catch (e) { fail(req, res, e); }
};
router.post(`${BASE}/signup/send`, signupSend);
router.post(`${BASE}/signup/resend`, signupSend);

router.post(`${BASE}/signup/verify`, async (req, res) => {
  try {
    await developerSchemaReady();
    const challengeId = str(req.body?.challengeId, 64);
    const rememberMe = req.body?.rememberMe !== false;
    const p = await pendingCitizen(challengeId);
    const ch = await pool.query(`SELECT channel FROM auth_otps WHERE id=$1`, [challengeId]);
    const channel: string | null = ch.rows[0]?.channel ?? null;
    await checkOtp(challengeId, req.body?.code, "signup");
    // The phone is verified only when the code arrived on it (SMS or WhatsApp).
    const phoneVerified = !!p.phone_e164 && channel !== "email";
    const username = await uniqueUsername(p.display_name);

    let userId: number;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const u = await client.query(
        `INSERT INTO users (username, email, password_hash, birth_date) VALUES ($1,$2,$3,$4) RETURNING id`,
        [username, p.email, p.password_hash, p.birth_date]);
      userId = u.rows[0].id;
      await client.query(
        `INSERT INTO auth_profiles (user_id, email, display_name, phone_e164, phone_verified) VALUES ($1,$2,$3,$4,$5)`,
        [userId, p.email, p.display_name, p.phone_e164, phoneVerified]);
      await client.query(`DELETE FROM auth_pending_citizens WHERE challenge_id=$1`, [challengeId]);
      await client.query("COMMIT");
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => {});
      if (e?.code === "23505") throw new AuthError(409, /username/i.test(String(e.constraint ?? e.detail)) ? "USERNAME_TAKEN" : "EMAIL_TAKEN");
      throw e;
    } finally { client.release(); }

    await respondLoggedIn(req, res, userId, rememberMe, 201);
  } catch (e) { fail(req, res, e); }
});

// ── Developer registration: email + username + password -> SMS code -> account ──
// Nothing is created until the code is verified. The pending row only holds a bcrypt hash.
const USERNAME_RE = /^[\p{L}\p{N}_]{3,20}$/u;
const PENDING_TTL = "30 minutes";

router.post(`${BASE}/developer/start`, async (req, res) => {
  try {
    await developerSchemaReady();
    const email = str(req.body?.email, 254).toLowerCase();
    const username = str(req.body?.username, 40);
    const password = req.body?.password;
    const phone = normalizePhone(req.body?.phone);
    if (!EMAIL_RE.test(email)) throw new AuthError(400, "EMAIL_INVALID");
    if (!USERNAME_RE.test(username) || hasBlockedKeyword(username)) throw new AuthError(400, "USERNAME_INVALID");
    if (!passwordOk(password)) throw new AuthError(400, "PASSWORD_WEAK");
    if (!phone) throw new AuthError(400, "PHONE_INVALID");
    // At least one channel must really deliver in production; the user picks which one on each send.
    if (!channelOptions({ phone, email }).length) throw new AuthError(503, "CHANNEL_UNAVAILABLE");

    const mailTaken = await pool.query(
      `SELECT 1 FROM users WHERE LOWER(email)=$1 UNION SELECT 1 FROM auth_profiles WHERE LOWER(email)=$1`, [email]);
    if (mailTaken.rowCount) throw new AuthError(409, "EMAIL_TAKEN");
    const nameTaken = await pool.query(`SELECT 1 FROM users WHERE LOWER(username)=LOWER($1)`, [username]);
    if (nameTaken.rowCount) throw new AuthError(409, "USERNAME_TAKEN");
    if (await findUserIdByVerifiedPhone(phone)) throw new AuthError(409, "PHONE_TAKEN");

    const passwordHash = await bcrypt.hash(password, 10);
    // No code is sent here: the user chooses SMS, WhatsApp or Email on the next step.
    const challengeId = await openChallenge("developer-signup", phone, null);
    await pool.query(`DELETE FROM auth_pending_signups WHERE LOWER(email)=$1 OR created_at < now() - interval '${PENDING_TTL}'`, [email]);
    await pool.query(
      `INSERT INTO auth_pending_signups (challenge_id, email, username, password_hash, phone_e164) VALUES ($1,$2,$3,$4,$5)`,
      [challengeId, email, username, passwordHash, phone]);
    res.json({ challengeId, channels: channelOptions({ phone, email }) });
  } catch (e) { fail(req, res, e); }
});

// The user picks the channel on every send. Each send replaces the code on the same challenge.
async function pendingSignup(challengeId: string) {
  const r = await pool.query(
    `SELECT * FROM auth_pending_signups WHERE challenge_id=$1 AND created_at > now() - interval '${PENDING_TTL}'`, [challengeId]);
  if (!r.rows[0]) throw new AuthError(400, "OTP_EXPIRED");
  return r.rows[0];
}

const developerSend = async (req: Request, res: Response) => {
  try {
    await developerSchemaReady();
    const challengeId = str(req.body?.challengeId, 64);
    const p = await pendingSignup(challengeId);
    const { channel, destination } = resolveChannel(req.body?.channel, { phone: p.phone_e164, email: p.email });
    const c = await sendChallengeCode(challengeId, "developer-signup", channel, destination);
    res.json({ challengeId, channel, resendIn: c.resendIn });
  } catch (e) { fail(req, res, e); }
};
router.post(`${BASE}/developer/send`, developerSend);
router.post(`${BASE}/developer/resend`, developerSend);

// Grants developer access to the signed-in account. Same login, same account, no new user.
router.post(`${BASE}/developer/enable`, async (req, res) => {
  try {
    await developerSchemaReady();
    const userId = req.session?.userId;
    if (!userId) throw new AuthError(401, "UNAUTHENTICATED");
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const row = await pool.query(`SELECT password_hash FROM users WHERE id=$1`, [userId]);
    const ok = !!row.rows[0] && (await bcrypt.compare(password, row.rows[0].password_hash).catch(() => false));
    if (!ok) throw new AuthError(401, "INVALID_CREDENTIALS");
    await pool.query(
      `INSERT INTO developer_particles (user_id, particle, value) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [userId, DEVELOPER_PARTICLE.key, DEVELOPER_PARTICLE.value]);
    res.json({ status: "ok", developer: true });
  } catch (e) { fail(req, res, e); }
});

router.post(`${BASE}/developer/verify`, async (req, res) => {
  try {
    await developerSchemaReady();
    const challengeId = str(req.body?.challengeId, 64);
    const rememberMe = req.body?.rememberMe !== false;
    await checkOtp(challengeId, req.body?.code, "developer-signup");
    const pending = await pool.query(
      `SELECT * FROM auth_pending_signups WHERE challenge_id=$1 AND created_at > now() - interval '${PENDING_TTL}'`, [challengeId]);
    const p = pending.rows[0];
    if (!p) throw new AuthError(400, "OTP_EXPIRED");

    let userId: number;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const u = await client.query(
        `INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING id`,
        [p.username, p.email, p.password_hash]);
      userId = u.rows[0].id;
      await client.query(
        `INSERT INTO auth_profiles (user_id, email, display_name, phone_e164, phone_verified) VALUES ($1,$2,$3,$4,true)`,
        [userId, p.email, p.username, p.phone_e164]);
      await client.query(`INSERT INTO citizen_profiles (user_id, display_name) VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING`, [userId, p.username]);
      await client.query(
        `INSERT INTO developer_particles (user_id, particle, value) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [userId, DEVELOPER_PARTICLE.key, DEVELOPER_PARTICLE.value]);
      await client.query(`DELETE FROM auth_pending_signups WHERE challenge_id=$1`, [challengeId]);
      await client.query("COMMIT");
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => {});
      if (e?.code === "23505") throw new AuthError(409, /username/i.test(String(e.constraint ?? e.detail)) ? "USERNAME_TAKEN" : "EMAIL_TAKEN");
      throw e;
    } finally { client.release(); }

    await createBaselineArchonSession(userId);
    await respondLoggedIn(req, res, userId, rememberMe, 201);
  } catch (e) { fail(req, res, e); }
});

// ── Login with email OR username ─────────────────────────────
router.post(`${BASE}/login`, async (req, res) => {
  try {
    const identifier = str(req.body?.identifier, 254);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const rememberMe = req.body?.rememberMe !== false;
    if (!identifier || !password) throw new AuthError(400, "CREDENTIALS_REQUIRED");
    const lower = identifier.toLowerCase();
    const found = await pool.query(
      `SELECT u.id, u.password_hash FROM users u LEFT JOIN auth_profiles p ON p.user_id = u.id
       WHERE LOWER(p.email) = $1 OR LOWER(u.email) = $1 OR LOWER(u.username) = $1 ORDER BY u.id LIMIT 2`, [lower]);
    let ok = false;
    if (found.rowCount === 1) ok = await bcrypt.compare(password, found.rows[0].password_hash).catch(() => false);
    else await bcrypt.compare(password, "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali").catch(() => false);
    if (!ok) throw new AuthError(401, "INVALID_CREDENTIALS");
    const userId: number = found.rows[0].id;

    if (!(await isTrustedDevice(userId, readCookie(req, DEVICE_COOKIE)))) {
      // New device: no code is sent yet. The user chooses a channel on /device/send.
      const dest = await accountDestinations(userId);
      const channels = channelOptions(dest);
      if (channels.length) {
        const challengeId = await openChallenge("device", (dest.phone ?? dest.email)!, userId);
        res.json({ status: "device_verification", challengeId, channels, rememberMe });
        return;
      }
    }
    await respondLoggedIn(req, res, userId, rememberMe);
  } catch (e) { fail(req, res, e); }
});

// ── New-device verification: the user picks a channel each time ──
const deviceSend = async (req: Request, res: Response) => {
  try {
    const challengeId = str(req.body?.challengeId, 64);
    const old = await pool.query(`SELECT user_id FROM auth_otps WHERE id=$1 AND purpose='device' AND NOT consumed`, [challengeId]);
    const userId: number | undefined = old.rows[0]?.user_id;
    if (!userId) throw new AuthError(400, "OTP_EXPIRED");
    const { channel, destination } = resolveChannel(req.body?.channel, await accountDestinations(userId));
    const c = await sendChallengeCode(challengeId, "device", channel, destination);
    res.json({ challengeId, channel, resendIn: c.resendIn });
  } catch (e) { fail(req, res, e); }
};
router.post(`${BASE}/device/send`, deviceSend);
router.post(`${BASE}/device/resend`, deviceSend);

router.post(`${BASE}/device/verify`, async (req, res) => {
  try {
    const { userId } = await checkOtp(req.body?.challengeId, req.body?.code, "device");
    if (!userId) throw new AuthError(400, "OTP_INVALID");
    await respondLoggedIn(req, res, userId, req.body?.rememberMe !== false);
  } catch (e) { fail(req, res, e); }
});

// ── Google sign-in (Google Identity Services ID token) ───────
interface GoogleIdentity { sub: string; email: string; name: string; picture: string | null }

async function verifyGoogle(credential: string): Promise<GoogleIdentity> {
  if (!prod() && process.env.AUTH_MOCK_GOOGLE === "1" && credential.startsWith("mock:")) {
    const [, sub, email, name] = credential.split(":");
    if (sub && email) return { sub, email: email.toLowerCase(), name: name || email.split("@")[0], picture: null };
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new AuthError(503, "GOOGLE_UNAVAILABLE");
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new AuthError(401, "GOOGLE_INVALID");
  const t = (await r.json()) as Record<string, string>;
  const issOk = t.iss === "accounts.google.com" || t.iss === "https://accounts.google.com";
  if (t.aud !== clientId || !issOk || t.email_verified !== "true" && (t.email_verified as unknown) !== true || !t.sub || !t.email) {
    throw new AuthError(401, "GOOGLE_INVALID");
  }
  return { sub: t.sub, email: t.email.toLowerCase(), name: t.name || t.email.split("@")[0], picture: t.picture ?? null };
}

router.post(`${BASE}/google`, async (req, res) => {
  try {
    const g = await verifyGoogle(str(req.body?.credential, 4096));
    const rememberMe = req.body?.rememberMe !== false;
    let userId: number | null = null;
    const bySub = await pool.query(`SELECT user_id FROM auth_profiles WHERE google_sub=$1`, [g.sub]);
    if (bySub.rows[0]) userId = bySub.rows[0].user_id;
    if (!userId) {
      // Google verified this address, so an existing account with the same email is the same person.
      const byEmail = await pool.query(
        `SELECT u.id FROM users u LEFT JOIN auth_profiles p ON p.user_id=u.id
         WHERE LOWER(p.email)=$1 OR LOWER(u.email)=$1 ORDER BY u.id LIMIT 1`, [g.email]);
      if (byEmail.rows[0]) {
        userId = byEmail.rows[0].id;
        await pool.query(
          `INSERT INTO auth_profiles (user_id, email, display_name, avatar_url, google_sub) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (user_id) DO UPDATE SET google_sub=EXCLUDED.google_sub,
             email=COALESCE(auth_profiles.email, EXCLUDED.email),
             display_name=COALESCE(auth_profiles.display_name, EXCLUDED.display_name),
             avatar_url=COALESCE(auth_profiles.avatar_url, EXCLUDED.avatar_url)`,
          [userId, g.email, g.name, g.picture, g.sub]);
      }
    }
    let created = false;
    if (!userId) {
      const username = await uniqueUsername(g.name);
      const hash = await bcrypt.hash(randomBytes(32).toString("hex"), 10); // unusable; sign-in is via Google
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const u = await client.query(`INSERT INTO users (username,email,password_hash) VALUES ($1,$2,$3) RETURNING id`, [username, g.email, hash]);
        userId = u.rows[0].id as number;
        await client.query(
          `INSERT INTO auth_profiles (user_id,email,display_name,avatar_url,google_sub) VALUES ($1,$2,$3,$4,$5)`,
          [userId, g.email, g.name, g.picture, g.sub]);
        await client.query("COMMIT");
        created = true;
      } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
      finally { client.release(); }
    } else if (g.picture) {
      await pool.query(`UPDATE auth_profiles SET avatar_url = COALESCE(avatar_url, $2) WHERE user_id=$1`, [userId, g.picture]);
    }
    await respondLoggedIn(req, res, userId!, rememberMe, created ? 201 : 200);
  } catch (e) { fail(req, res, e); }
});

// ── Forgot password: phone → SMS code → new password ─────────
router.post(`${BASE}/forgot/send`, async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) throw new AuthError(400, "PHONE_INVALID");
    if (!getSmsProvider()) throw new AuthError(503, "SMS_UNAVAILABLE");
    const userId = await findUserIdByVerifiedPhone(phone);
    // Unknown numbers get an identical response so the endpoint cannot be used to look up members.
    const c = userId ? await issueOtp("forgot", phone, userId) : decoyChallenge();
    res.json({ challengeId: c.id, resendIn: c.resendIn });
  } catch (e) { fail(req, res, e); }
});

// Email reset: emails a link that carries a one-time token in the URL hash (never in a query string or logs).
// The response is the same whether or not the address belongs to a member.
router.post(`${BASE}/forgot/email/send`, async (req, res) => {
  try {
    const email = str(req.body?.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new AuthError(400, "EMAIL_INVALID");
    if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) throw new AuthError(503, "CHANNEL_UNAVAILABLE");
    const found = await pool.query<{ user_id: number }>(
      `SELECT user_id FROM auth_profiles WHERE LOWER(email)=$1 AND user_id IS NOT NULL ORDER BY user_id LIMIT 1`, [email]);
    const userId = found.rows[0]?.user_id;
    if (userId) {
      const token = await mintResetToken(userId, email);
      const base = (process.env.APP_PUBLIC_URL || "https://www.gdnaarena.app").replace(/\/$/, "");
      await sendResetEmail(email, `${base}/login#reset-token=${token}`);
    }
    res.json({ ok: true });
  } catch (e) { fail(req, res, e); }
});

router.post(`${BASE}/forgot/verify`, async (req, res) => {
  try {
    const { userId, phone } = await checkOtp(req.body?.challengeId, req.body?.code, "forgot");
    if (!userId) throw new AuthError(400, "OTP_INVALID");
    res.json({ resetToken: await mintResetToken(userId, phone) });
  } catch (e) { fail(req, res, e); }
});

router.post(`${BASE}/forgot/reset`, async (req, res) => {
  try {
    if (!passwordOk(req.body?.newPassword)) throw new AuthError(400, "PASSWORD_WEAK");
    const userId = await consumeResetToken(req.body?.resetToken);
    const hash = await bcrypt.hash(req.body.newPassword, 10);
    const client = await pool.connect();
    let revoked: string[] = [];
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(47201, 1)");
      const up = await client.query(
        `UPDATE users SET password_hash=$1, credential_epoch=credential_epoch+1 WHERE id=$2 AND password_hash <> 'DELETED' RETURNING credential_epoch`,
        [hash, userId]);
      if (!up.rows[0]) throw new AuthError(400, "RESET_INVALID");
      await client.query(
        `INSERT INTO auth_offline_recovery_revocations (user_id, credential_epoch) VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET credential_epoch=EXCLUDED.credential_epoch, created_at=NOW()`,
        [userId, up.rows[0].credential_epoch]);
      const s = await client.query<{ sid: string }>(`DELETE FROM user_sessions WHERE sess->>'userId'=$1::text RETURNING sid`, [userId]);
      revoked = s.rows.map(r => r.sid);
      // Every other device must prove itself again with the new password (and an SMS code).
      await client.query(`DELETE FROM auth_trusted_devices WHERE user_id=$1`, [userId]);
      await revokeRecoveryPushBindings(client, userId);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
    finally { client.release(); }
    for (const sid of revoked) disconnectSessionSockets(sid);
    disconnectUserSockets(userId);
    await completeOfflineRecoveryRevocation(userId).catch(() => false);
    // The citizen just proved the phone from this browser, so this browser stays trusted.
    setDeviceCookie(res, await trustDevice(userId, readCookie(req, DEVICE_COOKIE), deviceLabel(req)));
    res.json({ status: "ok" });
  } catch (e) { fail(req, res, e); }
});

// ── Attach / verify a phone for a signed-in citizen ──────────
router.post(`${BASE}/phone/send`, async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) throw new AuthError(401, "AUTH_REQUIRED");
    const phone = normalizePhone(req.body?.phone);
    if (!phone) throw new AuthError(400, "PHONE_INVALID");
    const owner = await findUserIdByVerifiedPhone(phone);
    if (owner && owner !== userId) throw new AuthError(409, "PHONE_TAKEN");
    const c = await issueOtp("phone-verify", phone, userId);
    res.json({ challengeId: c.id, resendIn: c.resendIn });
  } catch (e) { fail(req, res, e); }
});

router.post(`${BASE}/phone/verify`, async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) throw new AuthError(401, "AUTH_REQUIRED");
    const { userId: owner, phone } = await checkOtp(req.body?.challengeId, req.body?.code, "phone-verify");
    if (owner !== userId) throw new AuthError(400, "OTP_INVALID");
    try {
      await pool.query(
        `INSERT INTO auth_profiles (user_id, phone_e164, phone_verified) VALUES ($1,$2,true)
         ON CONFLICT (user_id) DO UPDATE SET phone_e164=EXCLUDED.phone_e164, phone_verified=true`, [userId, phone]);
    } catch (e: any) {
      if (e?.code === "23505") throw new AuthError(409, "PHONE_TAKEN");
      throw e;
    }
    res.json({ status: "ok", maskedPhone: maskPhone(phone) });
  } catch (e) { fail(req, res, e); }
});

// ── Development only: read the last mock SMS so tests can finish an OTP flow ──
if (!prod()) {
  router.get(`${BASE}/dev/last-sms`, (req, res) => {
    if (process.env.AUTH_EXPOSE_DEV_OTP !== "1") { res.status(404).end(); return; }
    const to = typeof req.query.phone === "string" ? req.query.phone : "";
    const hit = [...mockOutbox].reverse().find(m => m.to === to);
    res.json({ code: hit?.text.match(/\d{6}/)?.[0] ?? null });
  });
}

export default router;
