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
  AuthError, DEVICE_COOKIE, DEVICE_TTL_MS, authSchemaReady, checkOtp, consumeResetToken, decoyChallenge,
  findUserIdByVerifiedPhone, getProfile, isTrustedDevice, issueOtp, maskPhone, mintResetToken,
  normalizePhone, trustDevice, userVerifiedPhone,
} from "../lib/auth-store";
import { serializeWithProfile } from "./auth";

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
  });
});

// ── Sign up with email ───────────────────────────────────────
router.post(`${BASE}/signup`, async (req, res) => {
  try {
    const name = str(req.body?.name, 40);
    const email = str(req.body?.email, 254).toLowerCase();
    const password = req.body?.password;
    const phoneRaw = str(req.body?.phone, 30);
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
    const birthDate = normalizeBirthDate(req.body?.birthDate);
    const rememberMe = req.body?.rememberMe !== false;
    if (name.length < 2) throw new AuthError(400, "NAME_INVALID");
    if (!EMAIL_RE.test(email)) throw new AuthError(400, "EMAIL_INVALID");
    if (!passwordOk(password)) throw new AuthError(400, "PASSWORD_WEAK");
    if (phoneRaw && !phone) throw new AuthError(400, "PHONE_INVALID");
    if (!birthDate) throw new AuthError(400, "BIRTHDATE_INVALID");
    if (hasBlockedKeyword(name)) throw new AuthError(400, "NAME_INVALID");

    const taken = await pool.query(
      `SELECT 1 FROM users WHERE LOWER(email)=$1 UNION SELECT 1 FROM auth_profiles WHERE LOWER(email)=$1`, [email]);
    if (taken.rowCount) throw new AuthError(409, "EMAIL_TAKEN");

    const username = await uniqueUsername(name);
    const passwordHash = await bcrypt.hash(password, 10);
    let userId: number;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const u = await client.query(
        `INSERT INTO users (username, email, password_hash, birth_date) VALUES ($1,$2,$3,$4) RETURNING id`,
        [username, email, passwordHash, birthDate]);
      userId = u.rows[0].id;
      await client.query(
        `INSERT INTO auth_profiles (user_id, email, display_name, phone_e164, phone_verified) VALUES ($1,$2,$3,$4,false)`,
        [userId, email, name, phone]);
      await client.query("COMMIT");
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => {});
      if (e?.code === "23505") throw new AuthError(409, "EMAIL_TAKEN");
      throw e;
    } finally { client.release(); }

    // The phone is only trusted for recovery after its owner proves it with a code.
    let phoneChallenge: { id: string; resendIn: number } | null = null;
    if (phone && getSmsProvider()) {
      phoneChallenge = await issueOtp("phone-verify", phone, userId).catch(() => null);
    }
    const row = await loadUser(userId);
    await startSession(req, res, userId, row.credentialEpoch, rememberMe);
    setDeviceCookie(res, await trustDevice(userId, readCookie(req, DEVICE_COOKIE), deviceLabel(req)));
    res.status(201).json({
      status: "ok", user: await serializeWithProfile(row.user),
      phoneChallengeId: phoneChallenge?.id ?? null,
    });
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
      const phone = await userVerifiedPhone(userId);
      if (phone && (smsIsReal() || !prod())) {
        const challenge = await issueOtp("device", phone, userId);
        res.json({ status: "device_verification", challengeId: challenge.id, maskedPhone: maskPhone(phone), resendIn: challenge.resendIn, rememberMe });
        return;
      }
    }
    await respondLoggedIn(req, res, userId, rememberMe);
  } catch (e) { fail(req, res, e); }
});

// ── New-device SMS verification ──────────────────────────────
router.post(`${BASE}/device/resend`, async (req, res) => {
  try {
    const old = await pool.query(`SELECT user_id, phone_e164 FROM auth_otps WHERE id=$1 AND purpose='device'`, [str(req.body?.challengeId, 64)]);
    if (!old.rows[0]) throw new AuthError(400, "OTP_EXPIRED");
    const c = await issueOtp("device", old.rows[0].phone_e164, old.rows[0].user_id);
    res.json({ challengeId: c.id, resendIn: c.resendIn });
  } catch (e) { fail(req, res, e); }
});

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
