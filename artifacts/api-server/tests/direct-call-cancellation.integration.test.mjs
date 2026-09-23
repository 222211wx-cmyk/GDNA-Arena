import assert from "node:assert/strict";
import { createCipheriv, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes } from "node:crypto";
import test from "node:test";
import WebSocket from "ws";

const apiBaseUrl = (process.env.API_BASE_URL ?? "http://localhost:80/api").replace(/\/$/, "");
const wsUrl = `${apiBaseUrl.replace(/^http/, "ws")}/ws`;
const directTransport = { provider: "webrtc", version: 1 };
const validOffer = {
  type: "offer",
  sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=test\r\nt=0 0\r\n",
};
const validAnswer = {
  type: "answer",
  sdp: "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=test\r\nt=0 0\r\n",
};

function unique(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function request(path, options = {}) {
  return fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
}

async function responseJson(response, expected) {
  const text = response.status === expected ? undefined : await response.text();
  assert.equal(response.status, expected, text);
  return response.json();
}

async function register(username) {
  const response = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username,
      password: "direct-call-cancellation-race-password",
      birthDate: "1990-01-01",
    }),
  });
  const account = await responseJson(response, 201);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return { id: account.id, username, cookie: setCookie.split(";", 1)[0] };
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
        if (!waiter.predicate(message)) continue;
        clearTimeout(waiter.timer);
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    });
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  waitFor(predicate, timeout = 5_000) {
    const cached = this.messages.find(predicate);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          reject(new Error(`Timed out waiting for WebSocket event; received: ${
            this.messages.map(message => `${message.type}:${message.callId ?? ""}`).join(", ")
          }`));
        }, timeout),
      };
      this.waiters.push(waiter);
    });
  }

  async expectNone(predicate, wait = 500) {
    assert.equal(this.messages.some(predicate), false, "unexpected prior WebSocket event");
    await new Promise(resolve => setTimeout(resolve, wait));
    assert.equal(this.messages.some(predicate), false, "unexpected WebSocket event");
  }

  async close() {
    if (this.ws.readyState !== WebSocket.OPEN && this.ws.readyState !== WebSocket.CONNECTING) return;
    await new Promise(resolve => {
      this.ws.once("close", resolve);
      this.ws.close();
    });
  }
}

async function connect(cookie) {
  const ws = new WebSocket(wsUrl, { headers: { cookie } });
  const probe = new Probe(ws);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  probe.send({ type: "register" });
  await probe.waitFor(message => message.type === "registered");
  return probe;
}

function offerMessage(callId, to, e2e) {
  return {
    type: "call-offer",
    to,
    callId,
    offer: validOffer,
    video: false,
    transport: directTransport,
    e2e,
  };
}

async function establishRinging(caller, callee, callId, calleeName, e2e) {
  const ready = caller.waitFor(message => message.type === "call-ready" && message.callId === callId);
  const incoming = callee.waitFor(message => message.type === "call-incoming" && message.callId === callId);
  caller.send(offerMessage(callId, calleeName, e2e));
  await Promise.all([ready, incoming]);
}

test("more than eight encrypted devices remain available for messaging and direct calls", async t => {
  const caller = await register(unique("mc"));
  const callee = await register(unique("md"));
  const callerSocket = await connect(caller.cookie);
  const calleeSocket = await connect(callee.cookie);
  t.after(async () => {
    await Promise.allSettled([callerSocket.close(), calleeSocket.close()]);
    await Promise.allSettled([
      request("/auth/me", { method: "DELETE", headers: { cookie: caller.cookie } }),
      request("/auth/me", { method: "DELETE", headers: { cookie: callee.cookie } }),
    ]);
  });

  const devices = {};
  const envelopeRecipients = [];
  for (let i = 0; i < 12; i++) {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const deviceId = unique(`device${i}`);
    const key = await responseJson(await request("/messages/e2e/key", {
      method: "PUT", headers: { cookie: callee.cookie },
      body: JSON.stringify({ deviceId, publicKey: publicKey.export({ format: "jwk" }) }),
    }), 200);
    envelopeRecipients.push({ userId: callee.id, deviceId, publicKey, privateKey, fingerprint: key.fingerprint });
  }
  const callSecret = randomBytes(32).toString("base64url");
  for (const recipient of envelopeRecipients) {
    devices[recipient.deviceId] = {
      wrappedSecret: publicEncrypt({ key: recipient.publicKey, oaepHash: "sha256" }, Buffer.from(callSecret)).toString("base64url"),
      fingerprint: recipient.fingerprint,
    };
    assert.equal(privateDecrypt({ key: recipient.privateKey, oaepHash: "sha256" },
      Buffer.from(devices[recipient.deviceId].wrappedSecret, "base64url")).toString(), callSecret);
  }
  const ownPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const ownDeviceId = unique("senderdevice");
  const ownKey = await responseJson(await request("/messages/e2e/key", {
    method: "PUT", headers: { cookie: caller.cookie },
    body: JSON.stringify({ deviceId: ownDeviceId, publicKey: ownPair.publicKey.export({ format: "jwk" }) }),
  }), 200);
  envelopeRecipients.push({
    userId: caller.id, deviceId: ownDeviceId, publicKey: ownPair.publicKey,
    privateKey: ownPair.privateKey, fingerprint: ownKey.fingerprint,
  });
  const listed = await responseJson(await request("/messages/e2e/devices", { headers: { cookie: callee.cookie } }), 200);
  assert.equal(listed.devices.length, 12);
  const keys = await responseJson(await request(`/messages/e2e/users/${callee.username}/key`, {
    headers: { cookie: caller.cookie },
  }), 200);
  assert.equal(keys.keys.length, 12, "all active fingerprints must be returned to the caller");
  const { room } = await responseJson(await request("/messages/rooms", {
    method: "POST", headers: { cookie: caller.cookie },
    body: JSON.stringify({ targetUsername: callee.username }),
  }), 201);
  const roomKeys = await responseJson(await request(`/messages/rooms/${room.id}/e2e-keys`, {
    headers: { cookie: caller.cookie },
  }), 200);
  assert.equal(roomKeys.keys.length, 13, "message sender and all 12 recipient identities are included");
  const aesKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ kind: "text", text: "encrypted delivery beyond eight devices" })), cipher.final(), cipher.getAuthTag()]);
  const wrapped = Object.fromEntries(envelopeRecipients.map(recipient => [
    `${recipient.userId}.${recipient.deviceId}`,
    { wrappedKey: publicEncrypt({ key: recipient.publicKey, oaepHash: "sha256" }, aesKey).toString("base64url"),
      fingerprint: recipient.fingerprint },
  ]));
  for (const recipient of envelopeRecipients) {
    assert.deepEqual(privateDecrypt({ key: recipient.privateKey, oaepHash: "sha256" },
      Buffer.from(wrapped[`${recipient.userId}.${recipient.deviceId}`].wrappedKey, "base64url")), aesKey);
  }
  const content = "e2e:v1:" + Buffer.from(JSON.stringify({
    v: 1, alg: "RSA-OAEP-256/A256GCM", iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"), keys: wrapped,
  })).toString("base64url");
  const delivered = await responseJson(await request(`/messages/rooms/${room.id}/send`, {
    method: "POST", headers: { cookie: caller.cookie }, body: JSON.stringify({ content, type: "text" }),
  }), 201);
  assert.equal(delivered.message.content, content, "server persists only the complete opaque encrypted envelope");
  const staleKeys = { ...wrapped, [`${callee.id}.${envelopeRecipients[0].deviceId}`]: {
    ...wrapped[`${callee.id}.${envelopeRecipients[0].deviceId}`], fingerprint: "f".repeat(43),
  } };
  const staleContent = "e2e:v1:" + Buffer.from(JSON.stringify({
    v: 1, alg: "RSA-OAEP-256/A256GCM", iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"), keys: staleKeys,
  })).toString("base64url");
  const rejected = await request(`/messages/rooms/${room.id}/send`, {
    method: "POST", headers: { cookie: caller.cookie },
    body: JSON.stringify({ content: staleContent, type: "text" }),
  });
  assert.equal(rejected.status, 409, "wrong fingerprint cannot bypass exact active-device validation");
  const differentKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey;
  const collision = await request("/messages/e2e/key", {
    method: "PUT", headers: { cookie: callee.cookie },
    body: JSON.stringify({ deviceId: envelopeRecipients[0].deviceId, publicKey: differentKey.export({ format: "jwk" }) }),
  });
  assert.equal(collision.status, 409, "registration must never replace a device's existing private-key identity");

  const rtc = await responseJson(await request("/rtc/ice-servers", { headers: { cookie: caller.cookie } }), 200);
  const transport = rtc.provider === "webrtc" ? directTransport : { provider: "agora", version: 1 };
  const callId = unique("manycall");
  const ready = callerSocket.waitFor(message => message.type === "call-ready" && message.callId === callId);
  const incoming = calleeSocket.waitFor(message => message.type === "call-incoming" && message.callId === callId);
  callerSocket.send({
    type: "call-offer", to: callee.username, callId, offer: transport.provider === "agora" ? null : validOffer,
    video: false, transport, e2e: { devices },
  });
  await Promise.all([ready, incoming]);
  const accepted = callerSocket.waitFor(message => message.type === "call-accepted" && message.callId === callId);
  calleeSocket.send({
    type: "call-answer", to: caller.username, callId,
    answer: transport.provider === "agora" ? null : validAnswer, transport,
  });
  await accepted;
  callerSocket.send({ type: "call-end", to: callee.username, callId });
  await calleeSocket.waitFor(message => message.type === "call-ended" && message.callId === callId);
});

test("direct call setup cancellation cannot orphan a pending offer", async t => {
  const caller = await register(unique("dcr"));
  const callee = await register(unique("dct"));
  const callerSocket = await connect(caller.cookie);
  const calleeSocket = await connect(callee.cookie);
  const probes = [callerSocket, calleeSocket];

  t.after(async () => {
    await Promise.allSettled(probes.map(probe => probe.close()));
    await Promise.allSettled([
      request("/auth/me", { method: "DELETE", headers: { cookie: caller.cookie } }),
      request("/auth/me", { method: "DELETE", headers: { cookie: callee.cookie } }),
    ]);
  });

  const iceConfig = await responseJson(await request("/rtc/ice-servers", {
    headers: { cookie: caller.cookie },
  }), 200);
  if (iceConfig.provider !== "webrtc") {
    t.skip("direct WebRTC cancellation regression requires the configured WebRTC provider");
    return;
  }

  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const deviceId = unique("device");
  const key = await responseJson(await request("/messages/e2e/key", {
    method: "PUT",
    headers: { cookie: callee.cookie },
    body: JSON.stringify({ deviceId, publicKey: publicKey.export({ format: "jwk" }) }),
  }), 200);
  const e2e = {
    devices: {
      [deviceId]: { wrappedSecret: "x".repeat(256), fingerprint: key.fingerprint },
    },
  };

  const canceledId = unique("offer-cancel");
  callerSocket.send(offerMessage(canceledId, callee.username, e2e));
  callerSocket.send({ type: "call-cancel", callId: canceledId });
  await calleeSocket.expectNone(
    message => message.type === "call-incoming" && message.callId === canceledId,
  );
  await callerSocket.expectNone(
    message => message.type === "call-ready" && message.callId === canceledId,
  );

  const afterCancelId = unique("after-cancel");
  await establishRinging(callerSocket, calleeSocket, afterCancelId, callee.username, e2e);
  const afterCancelEnded = calleeSocket.waitFor(
    message => message.type === "call-ended" && message.callId === afterCancelId,
  );
  callerSocket.send({ type: "call-end", callId: afterCancelId, to: callee.username });
  await afterCancelEnded;

  const closedId = unique("offer-close");
  const secondCallerSocket = await connect(caller.cookie);
  probes.push(secondCallerSocket);
  secondCallerSocket.send(offerMessage(closedId, callee.username, e2e));
  await secondCallerSocket.close();
  await calleeSocket.expectNone(
    message => message.type === "call-incoming" && message.callId === closedId,
  );

  const afterCloseId = unique("after-close");
  await establishRinging(callerSocket, calleeSocket, afterCloseId, callee.username, e2e);
  const afterCloseEnded = calleeSocket.waitFor(
    message => message.type === "call-ended" && message.callId === afterCloseId,
  );
  callerSocket.send({ type: "call-end", callId: afterCloseId, to: callee.username });
  await afterCloseEnded;

  const answeredId = unique("answer-cancel");
  await establishRinging(callerSocket, calleeSocket, answeredId, callee.username, e2e);
  const accepted = callerSocket.waitFor(
    message => message.type === "call-accepted" && message.callId === answeredId,
  );
  calleeSocket.send({
    type: "call-answer",
    to: caller.username,
    callId: answeredId,
    answer: validAnswer,
    transport: directTransport,
  });
  await accepted;
  const answeredEnded = calleeSocket.waitFor(
    message => message.type === "call-ended" && message.callId === answeredId,
  );
  callerSocket.send({ type: "call-cancel", callId: answeredId });
  const ended = await answeredEnded;
  assert.equal(ended.by, caller.username);

  const afterAnswerCancelId = unique("after-answer");
  await establishRinging(callerSocket, calleeSocket, afterAnswerCancelId, callee.username, e2e);
  const afterAnswerEnded = calleeSocket.waitFor(
    message => message.type === "call-ended" && message.callId === afterAnswerCancelId,
  );
  callerSocket.send({ type: "call-end", callId: afterAnswerCancelId, to: callee.username });
  await afterAnswerEnded;
});