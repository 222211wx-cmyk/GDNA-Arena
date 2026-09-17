import assert from "node:assert/strict";
import { generateKeyPairSync, publicEncrypt, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import WebSocket from "ws";

// Real HTTP, sessions, WebSockets, PostgreSQL and signed-token endpoints.
// This verifies signaling/authorization, NOT browser media or TURN allocation.
const base = (process.env.API_BASE_URL ?? "http://localhost:80/api").replace(/\/$/, "");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function json(path, cookie, method = "GET", body, expected = 200) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  // Never include cookies, credential responses or tokens in failure output.
  assert.equal(response.status, expected, `${method} ${path} returned unexpected HTTP status`);
  return { response, data: await response.json() };
}

async function citizen() {
  const username = `callqa${randomBytes(5).toString("hex")}`;
  const registered = await json("/auth/register", null, "POST", {
    username, password: randomBytes(24).toString("hex"), birthDate: "1990-01-01",
  }, 201);
  const cookie = registered.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "registration establishes an authenticated session");
  const deviceId = `device_${randomUUID().replaceAll("-", "")}`;
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const published = await json("/messages/e2e/key", cookie, "PUT", {
    deviceId, publicKey: publicKey.export({ format: "jwk" }),
  });
  return { username, cookie, deviceId, id: registered.data.id, publicKey, fingerprint: published.data.fingerprint };
}

async function socket(person) {
  const ws = new WebSocket(`${base.replace(/^http/, "ws")}/ws`, { headers: { cookie: person.cookie } });
  const messages = [];
  ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const wait = async predicate => {
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      const message = messages.find(predicate);
      if (message) return message;
      await delay(25);
    }
    throw new Error(`Expected signaling event did not arrive; types received: ${messages.map(m => m.type).join(", ")}`);
  };
  const send = message => ws.send(JSON.stringify(message));
  send({ type: "register", deviceId: person.deviceId });
  await wait(message => message.type === "registered");
  return { ws, send, wait };
}

test("FCM disabled: authenticated callers can join Agora, answer, resume and end", { timeout: 60_000 }, async t => {
  const config = (await json("/call-push/config")).data;
  assert.equal(config.pushEnabled, false, "run this regression with FCM disabled");
  assert.equal(config.callAuthorityReady, true, "call authority remains available independently");
  const people = [];
  const sockets = [];
  t.after(async () => {
    for (const peer of sockets) peer.ws.terminate();
    for (const person of people) {
      await json("/auth/me", person.cookie, "DELETE").catch(() => undefined);
    }
  });
  const a = await citizen(); people.push(a);
  const b = await citizen(); people.push(b);
  const caller = await socket(a); sockets.push(caller);
  const callee = await socket(b); sockets.push(callee);
  const rtc = (await json("/rtc/ice-servers", a.cookie)).data;
  assert.ok(rtc.provider === "agora" || rtc.provider === "hybrid");
  const directAgora = rtc.provider === "agora";
  const transport = { provider: directAgora ? "agora" : "webrtc", version: 1 };
  const turn = (await json("/turn/creds", a.cookie)).data;
  assert.ok(Array.isArray(turn.iceServers) && turn.iceServers.length > 0, "time-limited TURN credentials are issued");
  const callId = `callqa_${randomUUID().replaceAll("-", "")}`;
  caller.send({
    type: "call-offer", callId, to: b.username, offer: null,
    video: false, deferredMedia: !directAgora, transport,
    e2e: { devices: { [b.deviceId]: {
      fingerprint: b.fingerprint,
      wrappedSecret: publicEncrypt({ key: b.publicKey, oaepHash: "sha256" }, randomBytes(32)).toString("base64"),
    } } },
  });
  await caller.wait(m => m.type === "call-ready" && m.callId === callId);
  await callee.wait(m => m.type === "call-incoming" && m.callId === callId);
  const tokenPath = `/agora/token?channel=${callId}`;
  if (directAgora) {
    const credentials = (await json(`${tokenPath}&deviceId=${a.deviceId}`, a.cookie)).data;
    assert.ok(typeof credentials.token === "string" && credentials.token.length > 20, "caller can join while ringing");
  }
  await json(`${tokenPath}&deviceId=${b.deviceId}`, b.cookie, "GET", undefined, 403);
  callee.send({ type: "call-answer", callId, to: a.username, answer: null, deferredMedia: !directAgora, transport });
  await caller.wait(m => m.type === "call-accepted" && m.callId === callId);
  if (!directAgora) {
    caller.send({ type: "call-provider-switch", callId, provider: "agora" });
    await callee.wait(m => m.type === "call-provider-changed" && m.callId === callId);
  }
  for (const person of [a, b]) {
    const credentials = (await json(`${tokenPath}&deviceId=${person.deviceId}`, person.cookie)).data;
    assert.ok(typeof credentials.token === "string" && credentials.token.length > 20, "a signed token is returned");
    assert.equal(credentials.uid, person.id);
  }
  await json(`${tokenPath}&deviceId=device_not_selected_1234`, b.cookie, "GET", undefined, 403);
  callee.ws.terminate();
  const resumed = await socket(b); sockets.push(resumed);
  resumed.send({ type: "call-resume", callId });
  const snapshot = await resumed.wait(m => m.type === "call-resumed" && m.callId === callId);
  assert.equal(snapshot.transport.provider, "agora", "the acknowledged provider survives reconnect");
  caller.send({ type: "call-end", callId, to: b.username });
  await resumed.wait(m => m.type === "call-ended" && m.callId === callId);
  await json(`${tokenPath}&deviceId=${a.deviceId}`, a.cookie, "GET", undefined, 403);
});