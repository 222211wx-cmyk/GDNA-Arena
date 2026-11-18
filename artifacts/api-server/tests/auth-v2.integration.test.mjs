// Needs a running API with AUTH_MOCK_GOOGLE=1 AUTH_EXPOSE_DEV_OTP=1 (mock SMS), NODE_ENV!=production.
import assert from "node:assert/strict";
import test from "node:test";

const base = (process.env.API_BASE_URL ?? "http://localhost:8081/api").replace(/\/$/, "");

/** A browser: its own cookie jar. A new Browser() is a new device. */
class Browser {
  jar = new Map();
  async call(path, body, method = body ? "POST" : "GET") {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`${base}${path}`, {
      method, redirect: "manual",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(line)) this.jar.delete(name); else this.jar.set(name, pair.slice(i + 1));
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, setCookie: res.headers.getSetCookie().join("\n") };
  }
}

import { createRequire } from "node:module";
const { Client } = createRequire(new URL("../../../lib/db/package.json", import.meta.url))("pg");
let dbClient;
const getDb = async () => {
  if (!dbClient) { dbClient = new Client({ connectionString: process.env.DATABASE_URL }); await dbClient.connect(); }
  return dbClient;
};
test.after(async () => { await dbClient?.end(); });
const uid = () => Math.random().toString(36).slice(2, 10);
const phoneFor = () => `+2126${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const lastSms = async (b, phone) => (await b.call(`/auth/v2/dev/last-sms?phone=${encodeURIComponent(phone)}`)).data.code;
const signupBody = (over = {}) => ({
  name: `Tester ${uid()}`, email: `${uid()}@example.com`, password: "correct-horse-1",
  birthDate: "1990-05-17", ...over,
});

test("1. register with email -> logout -> login again", async () => {
  const b = new Browser();
  const body = signupBody();
  const s = await b.call("/auth/v2/signup", body);
  assert.equal(s.status, 201, JSON.stringify(s.data));
  assert.equal(s.data.user.displayName, body.name);
  assert.match(s.setCookie, /connect\.sid=[^;]+;[^\n]*HttpOnly/i);
  const me = await b.call("/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.data.email, body.email);
  assert.equal((await b.call("/auth/logout", {})).status, 200);
  assert.equal((await b.call("/auth/me")).status, 401);
  const wrong = await b.call("/auth/v2/login", { identifier: body.email, password: "nope-nope-1" });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.code, "INVALID_CREDENTIALS");
  const login = await b.call("/auth/v2/login", { identifier: body.email.toUpperCase(), password: body.password });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.status, "ok");
  // session cookie is persistent for ~30 days
  const exp = /connect\.sid=[^\n]*Expires=([^;]+)/i.exec(login.setCookie)?.[1];
  assert.ok(exp && Date.parse(exp) > Date.now() + 29 * 864e5 && Date.parse(exp) < Date.now() + 31 * 864e5);
  assert.equal((await b.call("/auth/me")).status, 200);
});

test("1b. legacy username login still works through the new endpoint", async () => {
  const b = new Browser();
  const username = `old${uid()}`.slice(0, 16);
  const reg = await b.call("/auth/register", { username, password: "legacy-pass-1", birthDate: "1985-01-01" });
  assert.equal(reg.status, 201);
  await b.call("/auth/logout", {});
  const login = await new Browser().call("/auth/v2/login", { identifier: username, password: "legacy-pass-1" });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.username, username);
});

test("2. register with Google -> refresh -> still logged in; same account on second Google login", async () => {
  const b = new Browser();
  const sub = uid(); const email = `${uid()}@gmail.com`;
  const g = await b.call("/auth/v2/google", { credential: `mock:${sub}:${email}:El Qaisy` });
  assert.equal(g.status, 201, JSON.stringify(g.data));
  assert.equal(g.data.user.displayName, "El Qaisy");
  for (let i = 0; i < 3; i++) {
    const me = await b.call("/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.data.id, g.data.user.id);
  }
  const again = await new Browser().call("/auth/v2/google", { credential: `mock:${sub}:${email}:El Qaisy` });
  assert.equal(again.status, 200);
  assert.equal(again.data.user.id, g.data.user.id);
  assert.equal((await new Browser().call("/auth/v2/google", { credential: "mock-garbage" })).status >= 400, true);
});

test("3. forgot password -> SMS OTP -> new password -> login", async () => {
  const b = new Browser();
  const phone = phoneFor();
  const body = signupBody({ phone });
  const s = await b.call("/auth/v2/signup", body);
  assert.equal(s.status, 201);
  // the phone must be proven before it can be used for recovery
  const early = await new Browser().call("/auth/v2/forgot/send", { phone });
  assert.equal(early.status, 200);
  assert.equal(await lastSms(b, phone), (await lastSms(b, phone))); // decoy or the signup code
  const v = await b.call("/auth/v2/phone/verify", { challengeId: s.data.phoneChallengeId, code: await lastSms(b, phone) });
  assert.equal(v.status, 200, JSON.stringify(v.data));

  const fresh = new Browser();
  // resend gap is enforced server side (60s)
  assert.equal((await fresh.call("/auth/v2/forgot/send", { phone })).status, 200);
  const tooSoon = await fresh.call("/auth/v2/forgot/send", { phone });
  assert.equal(tooSoon.status, 429);
  assert.equal(tooSoon.data.code, "OTP_TOO_SOON");
  await new Promise(r => setTimeout(r, 0));
  // age the previous codes so the test does not wait a real minute
  const db = await getDb();
  await db.query(`UPDATE auth_otps SET created_at = now() - interval '2 minutes' WHERE phone_e164 = $1`, [phone]);
  const send = await fresh.call("/auth/v2/forgot/send", { phone });
  assert.equal(send.status, 200, JSON.stringify(send.data));
  const code = await lastSms(fresh, phone);
  const bad = await fresh.call("/auth/v2/forgot/verify", { challengeId: send.data.challengeId, code: code === "000000" ? "111111" : "000000" });
  assert.equal(bad.status, 400);
  const ok = await fresh.call("/auth/v2/forgot/verify", { challengeId: send.data.challengeId, code });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await fresh.call("/auth/v2/forgot/reset", { resetToken: ok.data.resetToken, newPassword: "short" })).status, 400);
  const reset = await fresh.call("/auth/v2/forgot/reset", { resetToken: ok.data.resetToken, newPassword: "brand-new-pass-9" });
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  // token is single use, old password and old session are dead
  assert.equal((await fresh.call("/auth/v2/forgot/reset", { resetToken: ok.data.resetToken, newPassword: "another-pass-99" })).status, 400);
  assert.equal((await b.call("/auth/me")).status, 401);
  assert.equal((await new Browser().call("/auth/v2/login", { identifier: body.email, password: body.password })).status, 401);
  // new password works; the device was un-trusted by the reset, so SMS is asked again
  const login = await fresh.call("/auth/v2/login", { identifier: body.email, password: "brand-new-pass-9" });
  assert.equal(login.status, 200);
  assert.equal(login.data.status, "ok"); // the resetting browser is trusted
  const other = await new Browser().call("/auth/v2/login", { identifier: body.email, password: "brand-new-pass-9" });
  assert.equal(other.data.status, "device_verification"); // every other device must verify again
});

test("4. login from a new device -> SMS OTP -> device trusted", async () => {
  const phone = phoneFor();
  const body = signupBody({ phone });
  const first = new Browser();
  const s = await first.call("/auth/v2/signup", body);
  const db = await getDb();
  assert.equal((await first.call("/auth/v2/phone/verify", { challengeId: s.data.phoneChallengeId, code: await lastSms(first, phone) })).status, 200);

  // same device: no SMS
  await first.call("/auth/logout", {});
  const same = await first.call("/auth/v2/login", { identifier: body.email, password: body.password });
  assert.equal(same.data.status, "ok");

  // new device: password alone is not enough
  await db.query(`UPDATE auth_otps SET created_at = now() - interval '2 minutes' WHERE phone_e164 = $1`, [phone]);
  const other = new Browser();
  const step1 = await other.call("/auth/v2/login", { identifier: body.email, password: body.password });
  assert.equal(step1.status, 200);
  assert.equal(step1.data.status, "device_verification");
  assert.equal((await other.call("/auth/me")).status, 401);
  assert.match(step1.data.maskedPhone, /^\+212/);
  const code = await lastSms(other, phone);
  assert.equal((await other.call("/auth/v2/device/verify", { challengeId: step1.data.challengeId, code: code === "123456" ? "654321" : "123456" })).status, 400);
  const step2 = await other.call("/auth/v2/device/verify", { challengeId: step1.data.challengeId, code });
  assert.equal(step2.status, 200, JSON.stringify(step2.data));
  assert.equal((await other.call("/auth/me")).status, 200);
  assert.ok(other.jar.get("gdna_device"));
  // trusted now: logging out and in again needs no SMS
  await other.call("/auth/logout", {});
  const again = await other.call("/auth/v2/login", { identifier: body.email, password: body.password });
  assert.equal(again.data.status, "ok");
  // clearing cookies = new device again
  await db.query(`UPDATE auth_otps SET created_at = now() - interval '2 minutes' WHERE phone_e164 = $1`, [phone]);
  const cleared = await new Browser().call("/auth/v2/login", { identifier: body.email, password: body.password });
  assert.equal(cleared.data.status, "device_verification");
});

test("signup validation returns codes, never mixed-language text", async () => {
  const b = new Browser();
  for (const [over, code] of [
    [{ email: "nope" }, "EMAIL_INVALID"], [{ password: "short" }, "PASSWORD_WEAK"],
    [{ birthDate: "2090-01-01" }, "BIRTHDATE_INVALID"], [{ phone: "0612" }, "PHONE_INVALID"], [{ name: "x" }, "NAME_INVALID"],
  ]) {
    const r = await b.call("/auth/v2/signup", signupBody(over));
    assert.equal(r.status, 400); assert.equal(r.data.code, code);
    assert.ok(!/[\u0600-\u06FF]/.test(JSON.stringify(r.data)), "server errors are language-neutral codes");
  }
  const dup = signupBody(); await new Browser().call("/auth/v2/signup", dup);
  assert.equal((await b.call("/auth/v2/signup", { ...signupBody(), email: dup.email.toUpperCase() })).data.code, "EMAIL_TAKEN");
});

test("developer registration: code -> account + Particle, persists across logout/login; existing archon columns untouched", async () => {
  const b = new Browser();
  const phone = phoneFor();
  const email = `${uid()}@example.com`;
  const username = `dev_${uid()}`.slice(0, 16);
  const password = "correct-horse-1";
  const start = await b.call("/auth/v2/developer/start", { email, username, password, phone });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  // Nothing is created before the code is verified.
  assert.equal((await (await getDb()).query("SELECT 1 FROM users WHERE LOWER(username)=LOWER($1)", [username])).rowCount, 0);
  assert.equal((await b.call("/auth/v2/developer/verify", { challengeId: start.data.challengeId, code: "000000" })).status, 400);
  const code = await lastSms(b, phone);
  const done = await b.call("/auth/v2/developer/verify", { challengeId: start.data.challengeId, code });
  assert.equal(done.status, 201, JSON.stringify(done.data));
  assert.equal(done.data.user.username, username);
  assert.equal(done.data.user.developerParticle?.key, "fabrica");
  assert.equal((await b.call("/auth/me")).status, 200);

  const db = await getDb();
  const uidRow = (await db.query("SELECT id FROM users WHERE username=$1", [username])).rows[0].id;
  assert.equal((await db.query("SELECT 1 FROM citizen_profiles WHERE user_id=$1", [uidRow])).rowCount, 1);
  assert.equal((await db.query("SELECT 1 FROM archon_sessions WHERE user_id=$1", [uidRow])).rowCount, 1);
  assert.equal((await db.query("SELECT value FROM developer_particles WHERE user_id=$1 AND particle='fabrica'", [uidRow])).rows[0].value, 100);

  // Logout, then log in again on the same (now trusted) device: the Particle is read from the database.
  assert.equal((await b.call("/auth/logout", {})).status, 200);
  const again = b;
  const login = await again.call("/auth/v2/login", { identifier: username, password });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.user.developerParticle?.key, "fabrica");
  const profile = await again.call("/archon/profile");
  assert.equal(profile.data.developerParticle?.label, "FABRICA");
  assert.equal(profile.data.session.volontas, 0); // existing particles still served
  const pub = await new Browser().call(`/archon/profile/${username}`);
  assert.equal(pub.data.developerParticle?.value, 100);
  assert.ok("resilentia" in pub.data.dimensions);

  // Duplicates are refused.
  const dupe = await new Browser().call("/auth/v2/developer/start", { email, username: `x${uid()}`, password, phone: phoneFor() });
  assert.equal(dupe.status, 409);
  assert.equal(dupe.data.code, "EMAIL_TAKEN");
  const bad = await new Browser().call("/auth/v2/developer/start", { email: `${uid()}@example.com`, username: "a b", password, phone: phoneFor() });
  assert.equal(bad.data.code, "USERNAME_INVALID");
});
