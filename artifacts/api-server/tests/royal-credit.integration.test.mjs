import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import pg from "pg";
import WebSocket from "ws";

const apiBaseUrl = (process.env.API_BASE_URL ?? "http://localhost:80/api").replace(/\/$/, "");
const wsUrl = `${apiBaseUrl.replace(/^http/, "ws")}/ws`;

function cookieFrom(response) {
  const value = response.headers.get("set-cookie");
  assert.ok(value);
  return value.split(";", 1)[0];
}

async function request(path, options = {}) {
  return fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
}

async function register(username) {
  const response = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username,
      password: "disposable-royal-credit-pw",
      birthDate: "1990-01-01",
    }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  return cookieFrom(response);
}

function connect(cookie) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, { headers: { cookie } });
    const timeout = setTimeout(() => reject(new Error("WebSocket registration timed out")), 8_000);
    socket.on("open", () => socket.send(JSON.stringify({ type: "register" })));
    socket.on("message", raw => {
      if (JSON.parse(String(raw)).type !== "registered") return;
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.on("error", reject);
  });
}

function waitFor(socket, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 8_000);
    socket.on("message", function listener(raw) {
      const event = JSON.parse(String(raw));
      if (event.type !== type) return;
      clearTimeout(timeout);
      socket.off("message", listener);
      resolve(event);
    });
  });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test("Royal Reserve activation, expiry, debt-first repayment, and idempotency", async t => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for fixture-only expiry setup");
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const username = `rc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const cookie = await register(username);
  t.after(async () => {
    await request("/auth/me", { method: "DELETE", headers: { cookie } });
    await db.end();
  });

  let response = await request("/billing/credit", { headers: { cookie } });
  assert.equal(response.status, 200);
  let body = await response.json();
  assert.equal(body.policy.reserveMinutes, 120);
  assert.equal(body.policy.validHours, 48);
  assert.equal(body.policy.packageCostMinor, 1500);
  assert.equal(typeof body.policy.repaymentSandboxEnabled, "boolean");
  assert.equal(body.credit.canActivate, true);

  response = await request("/billing/repay", {
    method: "POST", headers: { cookie },
    body: JSON.stringify({ amountMinor: 100001, idempotencyKey: `overflow-${username}` }),
  });
  assert.equal(response.status, 400, "repayment input is capped at 1000 MAD");

  const reservePayload = { accepted: true, idempotencyKey: `reserve-${username}` };
  response = await request("/billing/reserve", {
    method: "POST", headers: { cookie }, body: JSON.stringify(reservePayload),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const reserveExpiry = (await request("/billing/credit", { headers: { cookie } }).then(r => r.json())).credit.reserveExpiresAt;

  // An exact retry is harmless and cannot extend/reset the existing reserve.
  response = await request("/billing/reserve", {
    method: "POST", headers: { cookie }, body: JSON.stringify(reservePayload),
  });
  assert.equal(response.status, 201);
  body = await request("/billing/credit", { headers: { cookie } }).then(r => r.json());
  assert.equal(body.credit.reserveExpiresAt, reserveExpiry);
  assert.equal(body.credit.debtMinor, 1500);

  response = await request("/billing/reserve", {
    method: "POST", headers: { cookie },
    body: JSON.stringify({ accepted: true, idempotencyKey: `reserve-again-${username}` }),
  });
  assert.equal(response.status, 409, "outstanding debt forbids another reserve");

  await db.query(
    `UPDATE royal_credit_accounts a SET reserve_expires_at=NOW()-INTERVAL '1 second'
     FROM users u WHERE a.user_id=u.id AND u.username=$1`,
    [username],
  );
  body = await request("/billing/credit", { headers: { cookie } }).then(r => r.json());
  assert.equal(body.credit.reserveMinutes, 0);
  assert.equal(body.credit.reserveExpiresAt, null);
  assert.equal(body.credit.debtMinor, 1500, "expiry never forgives reserve debt");

  const repayPayload = { amountMinor: 3000, idempotencyKey: `repay-${username}` };
  if (!body.policy?.repaymentSandboxEnabled) {
    response = await request("/billing/repay", {
      method: "POST", headers: { cookie }, body: JSON.stringify(repayPayload),
    });
    assert.equal(response.status, 409, "repayment is closed unless the server explicitly enables its sandbox");
    return;
  }
  const concurrent = await Promise.all([
    request("/billing/repay", { method: "POST", headers: { cookie }, body: JSON.stringify(repayPayload) }),
    request("/billing/repay", { method: "POST", headers: { cookie }, body: JSON.stringify(repayPayload) }),
  ]);
  assert.ok(concurrent.every(r => r.status === 201), "exact concurrent retries both succeed");
  body = await request("/billing/credit", { headers: { cookie } }).then(r => r.json());
  assert.equal(body.credit.debtMinor, 0);
  assert.equal(body.credit.balanceMinutes, 120, "debt is paid before remainder becomes top-up");

  response = await request("/billing/repay", {
    method: "POST", headers: { cookie },
    body: JSON.stringify({ amountMinor: 3001, idempotencyKey: repayPayload.idempotencyKey }),
  });
  assert.equal(response.status, 409, "same key with a different payload conflicts");

  await db.query(
    `UPDATE royal_credit_accounts a SET paid_seconds=31536000
     FROM users u WHERE a.user_id=u.id AND u.username=$1`,
    [username],
  );
  response = await request("/billing/repay", {
    method: "POST", headers: { cookie },
    body: JSON.stringify({ amountMinor: 1, idempotencyKey: `total-cap-${username}` }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /one year/i);
});

test("call metering rejects unfunded calls and ignores spoofed, one-sided, and disconnected media", async t => {
  assert.ok(process.env.DATABASE_URL);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const suffix = `${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 4)}`;
  const callerName = `rcc${suffix}`;
  const calleeName = `rct${suffix}`;
  const attackerName = `rcx${suffix}`;
  const callerCookie = await register(callerName);
  const calleeCookie = await register(calleeName);
  const attackerCookie = await register(attackerName);
  const caller = await connect(callerCookie);
  const callee = await connect(calleeCookie);
  const attacker = await connect(attackerCookie);
  t.after(async () => {
    caller.close(); callee.close(); attacker.close();
    await Promise.allSettled([callerCookie, calleeCookie, attackerCookie].map(cookie =>
      request("/auth/me", { method: "DELETE", headers: { cookie } })));
    await db.end();
  });

  const unfundedId = `unfunded-${suffix}`;
  const creditRequired = waitFor(caller, "call-unavailable");
  caller.send(JSON.stringify({ type: "call-offer", to: calleeName, callId: unfundedId, video: false, offer: null }));
  assert.equal((await creditRequired).code, "CREDIT_REQUIRED");

  let response = await request("/billing/reserve", {
    method: "POST", headers: { cookie: callerCookie },
    body: JSON.stringify({ accepted: true, idempotencyKey: `call-reserve-${suffix}` }),
  });
  assert.equal(response.status, 201, await response.clone().text());

  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const deviceId = `device_${suffix}_secure`;
  response = await request("/messages/e2e/key", {
    method: "PUT", headers: { cookie: calleeCookie },
    body: JSON.stringify({ deviceId, publicKey: publicKey.export({ format: "jwk" }) }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const key = await response.json();
  const callId = `meter-${suffix}`;
  const ready = waitFor(caller, "call-ready");
  const incoming = waitFor(callee, "call-incoming");
  caller.send(JSON.stringify({
    type: "call-offer", to: calleeName, callId, video: false, offer: null,
    e2e: { devices: { [deviceId]: { wrappedSecret: "x".repeat(256), fingerprint: key.fingerprint } } },
  }));
  await Promise.all([ready, incoming]);
  const accepted = waitFor(caller, "call-accepted");
  callee.send(JSON.stringify({ type: "call-answer", to: callerName, callId, answer: null }));
  await accepted;

  const balance = async () => {
    const result = await db.query(
      `SELECT a.paid_seconds::int paid, a.reserve_seconds::int reserve
       FROM royal_credit_accounts a JOIN users u ON u.id=a.user_id WHERE u.username=$1`,
      [callerName],
    );
    return result.rows[0].paid + result.rows[0].reserve;
  };
  const initial = await balance();
  // A third participant cannot forge either bound device's heartbeat.
  attacker.send(JSON.stringify({ type: "call-media-state", callId, connected: true }));
  await delay(1_200);
  assert.equal(await balance(), initial);

  caller.send(JSON.stringify({ type: "call-media-state", callId, connected: true }));
  await delay(1_200);
  assert.equal(await balance(), initial, "one-sided media is never billed");

  callee.send(JSON.stringify({ type: "call-media-state", callId, connected: true }));
  await delay(2_300);
  const afterConnected = await balance();
  assert.ok(afterConnected < initial, "fresh heartbeats from both bound sockets are billed");
  const usage = await db.query(
    `SELECT cost_minor::int cost_minor, metadata
     FROM debt_log d JOIN users u ON u.id=d.user_id
     WHERE u.username=$1 AND d.action='call_usage' ORDER BY d.created_at DESC LIMIT 1`,
    [callerName],
  );
  assert.equal(usage.rows[0]?.cost_minor, 0);
  assert.ok(usage.rows[0]?.metadata?.consumedSeconds > 0);
  assert.equal(
    usage.rows[0].metadata.consumedSeconds,
    usage.rows[0].metadata.paidSeconds + usage.rows[0].metadata.reserveSeconds,
  );

  callee.send(JSON.stringify({ type: "call-media-state", callId, connected: false }));
  await delay(1_300);
  assert.equal(await balance(), afterConnected, "disconnect intervals are not billed or caught up");
  caller.send(JSON.stringify({ type: "call-end", to: calleeName, callId }));
});

test("soft account erasure preserves append-only Royal debt evidence", async t => {
  assert.ok(process.env.DATABASE_URL);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const username = `rce${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
  const cookie = await register(username);
  t.after(() => db.end());
  let response = await request("/billing/reserve", {
    method: "POST", headers: { cookie },
    body: JSON.stringify({ accepted: true, idempotencyKey: `erase-${username}` }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  response = await request("/auth/me", { method: "DELETE", headers: { cookie } });
  assert.equal(response.status, 200, await response.clone().text());
  const evidence = await db.query(
    `SELECT u.username, COUNT(d.id)::int entries
     FROM users u JOIN debt_log d ON d.user_id=u.id
     WHERE u.username LIKE 'deleted_user_%'
       AND d.idempotency_key=$1
     GROUP BY u.username`,
    [`erase-${username}`],
  );
  assert.match(evidence.rows[0]?.username ?? "", /^deleted_user_/);
  assert.equal(evidence.rows[0]?.entries, 1);
});