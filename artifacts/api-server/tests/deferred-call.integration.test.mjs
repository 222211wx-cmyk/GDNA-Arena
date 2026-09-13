import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const apiBaseUrl = (process.env.API_BASE_URL ?? "http://localhost:80/api").replace(/\/$/, "");
const wsUrl = apiBaseUrl.replace(/^http/, "ws") + "/ws";
const requireFromApi = createRequire(new URL("../package.json", import.meta.url));
const WebSocket = requireFromApi("ws");
const requireFromDb = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const { Client } = requireFromDb("pg");

function unique(prefix) {
  return `${prefix.slice(0, 4)}${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

async function request(path, options = {}) {
  return fetch(`${apiBaseUrl}${path}`, {
    redirect: "manual",
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
}

async function responseJson(response, expected) {
  const text = response.status === expected ? undefined : await response.text();
  assert.equal(response.status, expected, text);
  return response.json();
}

async function registerWithSession(username) {
  const response = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username,
      password: "deferred-web-call-test-password",
      birthDate: "1990-01-01",
    }),
  });
  const body = await responseJson(response, 201);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "registration must establish a session");
  return { ...body, cookie: setCookie.split(";", 1)[0] };
}

class Probe {
  constructor(ws) {
    this.ws = ws;
    this.messages = [];
    this.waiters = [];
    ws.on("message", raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      this.messages.push(message);
      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(message)) {
          clearTimeout(waiter.timer);
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    });
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  waitFor(predicate, timeout = 4_000) {
    const cached = this.messages.find(predicate);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          reject(new Error(`Timed out waiting for WebSocket event; received: ${this.messages.map(message => `${message.type}:${message.callId ?? ""}`).join(", ")}`));
        }, timeout),
      };
      this.waiters.push(waiter);
    });
  }

  async expectNone(predicate, wait = 250) {
    assert.equal(this.messages.some(predicate), false, "unexpected prior WebSocket event");
    await new Promise(resolve => setTimeout(resolve, wait));
    assert.equal(this.messages.some(predicate), false, "unexpected WebSocket event");
  }

  async close() {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      await new Promise(resolve => {
        this.ws.once("close", resolve);
        this.ws.close();
      });
    }
  }
}

async function connect(cookie) {
  const ws = new WebSocket(wsUrl, { headers: { cookie } });
  const probe = new Probe(ws);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  probe.send({ type: "register", userId: -1, username: "ignored-by-server" });
  await probe.waitFor(message => message.type === "registered");
  return probe;
}

async function activateReserve(cookie) {
  await responseJson(await request("/billing/reserve", {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ accepted: true, idempotencyKey: unique("reserve") }),
  }), 201);
}

async function registerCalleeKey(cookie, deviceId) {
  return responseJson(await request("/messages/e2e/key", {
    method: "PUT",
    headers: { cookie },
    body: JSON.stringify({
      deviceId,
      publicKey: {
        kty: "RSA",
        n: "a".repeat(342),
        e: "AQAB",
        alg: "RSA-OAEP-256",
        ext: true,
        key_ops: ["encrypt", "wrapKey"],
      },
    }),
  }), 200);
}

function deferredOffer(callId, to, device) {
  return {
    type: "call-offer",
    to,
    from: "untrusted-client-name",
    callId,
    offer: null,
    video: true,
    deferredMedia: true,
    transport: { provider: "webrtc", version: 1 },
    e2e: {
      devices: {
        [device.deviceId]: {
          fingerprint: device.fingerprint,
          wrappedSecret: "w".repeat(160),
        },
      },
    },
  };
}

const validOffer = { type: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=test\r\nt=0 0\r\n" };
const validAnswer = { type: "answer", sdp: "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=test\r\nt=0 0\r\n" };

test("deferred WebRTC invitations authenticate, bind one callee, and support Firestore or WS fallback", async t => {
  const caller = await registerWithSession(unique("caller"));
  const callee = await registerWithSession(unique("callee"));
  const outsider = await registerWithSession(unique("outsider"));
  const probes = [];
  t.after(async () => {
    await Promise.allSettled([
      ...probes.map(probe => probe.close()),
      request("/auth/me", { method: "DELETE", headers: { cookie: caller.cookie } }),
      request("/auth/me", { method: "DELETE", headers: { cookie: callee.cookie } }),
      request("/auth/me", { method: "DELETE", headers: { cookie: outsider.cookie } }),
    ]);
  });

  const config = await responseJson(await request("/call-push/config"), 200);
  assert.equal(typeof config.enabled, "boolean");
  // Configured deployments use Firestore as canonical state; local runs
  // without Firebase web configuration exercise the bounded WS fallback.
  await activateReserve(caller.cookie);
  const key = await registerCalleeKey(callee.cookie, unique("device"));

  const callerWs = await connect(caller.cookie);
  const calleeFirst = await connect(callee.cookie);
  const calleeSecond = await connect(callee.cookie);
  const outsiderWs = await connect(outsider.cookie);
  probes.push(callerWs, calleeFirst, calleeSecond, outsiderWs);

  const firstId = unique("call");
  callerWs.send(deferredOffer(firstId, callee.username, key));
  await callerWs.waitFor(message => message.type === "call-ready" && message.callId === firstId);
  const incoming = await calleeFirst.waitFor(message => message.type === "call-incoming" && message.callId === firstId);
  assert.equal(incoming.offer, null);
  assert.equal(incoming.deferredMedia, true);
  assert.equal(incoming.callerId, caller.id);
  assert.equal(incoming.callerName, caller.username);
  assert.ok(Object.hasOwn(incoming, "callerAvatar"));
  assert.match(incoming.expiresAt, /^\d{4}-\d\d-\d\dT/);

  callerWs.send({ type: "ice-candidate", to: callee.username, callId: firstId, candidate: { candidate: "candidate:early" } });
  callerWs.send({ type: "call-webrtc-offer", callId: firstId, offer: validOffer });
  await calleeFirst.expectNone(message =>
    (message.type === "ice-candidate" || message.type === "call-webrtc-offer") && message.callId === firstId,
  );

  outsiderWs.send({ type: "call-resume", callId: firstId });
  outsiderWs.send({
    type: "call-answer",
    to: caller.username,
    callId: firstId,
    answer: null,
    transport: { provider: "webrtc", version: 1 },
  });
  await callerWs.expectNone(message => message.type === "call-accepted" && message.callId === firstId);

  // A resumed secondary tab is allowed to display the invitation, but cannot
  // reserve the answer path before a real answer is sent.
  calleeSecond.send({ type: "call-resume", callId: firstId });
  await calleeSecond.waitFor(message => message.type === "call-resumed" && message.callId === firstId);
  calleeFirst.send({
    type: "call-answer",
    to: caller.username,
    callId: firstId,
    answer: null,
    transport: { provider: "webrtc", version: 1 },
  });
  const accepted = await callerWs.waitFor(message => message.type === "call-accepted" && message.callId === firstId);
  assert.equal(accepted.answer, null);
  calleeSecond.send({
    type: "call-answer",
    to: caller.username,
    callId: firstId,
    answer: null,
    transport: { provider: "webrtc", version: 1 },
  });
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(callerWs.messages.filter(message => message.type === "call-accepted" && message.callId === firstId).length, 1);

  callerWs.send({ type: "call-webrtc-offer", callId: firstId, offer: validOffer });
  await calleeFirst.waitFor(message => message.type === "call-webrtc-offer" && message.callId === firstId && message.offer?.sdp === validOffer.sdp);
  calleeFirst.send({ type: "call-webrtc-answer", callId: firstId, answer: validAnswer });
  await callerWs.waitFor(message => message.type === "call-webrtc-answer" && message.callId === firstId && message.answer?.sdp === validAnswer.sdp);
  callerWs.send({ type: "call-end", to: callee.username, callId: firstId });
  await calleeFirst.waitFor(message => message.type === "call-ended" && message.callId === firstId);
  await calleeSecond.waitFor(message => message.type === "call-ended" && message.callId === firstId);

  // HTTP decline is session-bound, callee-owned, and origin-protected. Keep
  // the call ringing while each negative assertion runs, then verify the
  // legitimate callee action closes every tab and the caller.
  const httpDeclineId = unique("call");
  callerWs.send(deferredOffer(httpDeclineId, callee.username, key));
  await calleeFirst.waitFor(message => message.type === "call-incoming" && message.callId === httpDeclineId);

  await responseJson(await request(`/call/decline?id=${httpDeclineId}`, {
    method: "POST",
  }), 401);
  await responseJson(await request(`/call/decline?id=${httpDeclineId}`, {
    method: "POST",
    headers: { cookie: outsider.cookie },
  }), 403);
  await responseJson(await request(`/call/decline?id=${httpDeclineId}`, {
    method: "POST",
    headers: { cookie: callee.cookie, origin: "https://attacker.invalid" },
  }), 403);
  await responseJson(await request("/call/decline?id=invalid%20call%20id", {
    method: "POST",
    headers: { cookie: callee.cookie },
  }), 400);

  const declinedHttp = await responseJson(await request(`/call/decline?id=${httpDeclineId}`, {
    method: "POST",
    headers: { cookie: callee.cookie, origin: new URL(apiBaseUrl).origin },
  }), 200);
  assert.equal(declinedHttp.ok, true);
  assert.equal(declinedHttp.callId, httpDeclineId);
  assert.equal(declinedHttp.status, "declined");
  assert.equal(declinedHttp.changed, true);
  const callerDeclined = await callerWs.waitFor(
    message => message.type === "call-rejected" && message.callId === httpDeclineId,
  );
  assert.equal(callerDeclined.callId, httpDeclineId);
  await calleeFirst.waitFor(message => message.type === "call-ended" && message.callId === httpDeclineId);
  await calleeSecond.waitFor(message => message.type === "call-ended" && message.callId === httpDeclineId);

  const repeatedDecline = await responseJson(await request(`/call/decline?id=${httpDeclineId}`, {
    method: "POST",
    headers: { cookie: callee.cookie },
  }), 200);
  assert.equal(repeatedDecline.ok, true);
  assert.equal(repeatedDecline.callId, httpDeclineId);
  assert.equal(repeatedDecline.status, "declined");
  assert.equal(repeatedDecline.changed, false);

  const declinedId = unique("call");
  callerWs.send(deferredOffer(declinedId, callee.username, key));
  await calleeFirst.waitFor(message => message.type === "call-incoming" && message.callId === declinedId);
  calleeFirst.send({ type: "call-reject", to: caller.username, callId: declinedId });
  await callerWs.waitFor(message => message.type === "call-rejected" && message.callId === declinedId);
  await calleeSecond.waitFor(message => message.type === "call-ended" && message.callId === declinedId);

  const cancelledId = unique("call");
  callerWs.send(deferredOffer(cancelledId, callee.username, key));
  await calleeFirst.waitFor(message => message.type === "call-incoming" && message.callId === cancelledId);
  callerWs.send({ type: "call-cancel", callId: cancelledId });
  await calleeFirst.waitFor(message => message.type === "call-rejected" && message.callId === cancelledId);
  await calleeSecond.waitFor(message => message.type === "call-rejected" && message.callId === cancelledId);

  const timeoutId = unique("call");
  callerWs.send(deferredOffer(timeoutId, callee.username, key));
  await calleeFirst.waitFor(message => message.type === "call-incoming" && message.callId === timeoutId);
  const timedOut = await callerWs.waitFor(
    message => message.type === "call-ended" && message.callId === timeoutId && message.code === "RING_TIMEOUT",
    35_000,
  );
  assert.equal(timedOut.by, "timeout");
  await calleeFirst.waitFor(message => message.type === "call-ended" && message.callId === timeoutId && message.code === "RING_TIMEOUT");
  await calleeSecond.waitFor(message => message.type === "call-ended" && message.callId === timeoutId && message.code === "RING_TIMEOUT");

  if (!config.enabled) {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for legacy missed-call verification");
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    t.after(() => db.end());
    // Ring-stop delivery must not wait for database I/O. Allow the separately
    // persisted terminal event to finish before asserting durable history.
    let missed;
    for (let attempt = 0; attempt < 40; attempt++) {
      missed = await db.query(
        `SELECT status, count(*)::int AS count
         FROM call_history
         WHERE caller_id = $1 AND callee_id = $2 AND status = 'missed'
         GROUP BY status`,
        [caller.id, callee.id],
      );
      if (missed.rows[0]?.count >= 2) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(missed.rows[0]?.status, "missed");
    assert.ok(missed.rows[0]?.count >= 2, "declined and timeout calls must use the legacy missed-call path");
  }
});