import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
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
  await responseJson(response, 201);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return { username, cookie: setCookie.split(";", 1)[0] };
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