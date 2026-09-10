import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
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
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

async function register(username) {
  const response = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username,
      password: "disposable-agora-auth-pw",
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
      const event = JSON.parse(String(raw));
      if (event.type !== "registered") return;
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.on("error", reject);
  });
}

function waitFor(socket, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 8_000);
    socket.on("message", function onMessage(raw) {
      const event = JSON.parse(String(raw));
      if (event.type !== type) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(event);
    });
  });
}

test("caller receives authorization acknowledgement before requesting an Agora token", async t => {
  const suffix = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
  const callerName = `ac${suffix}`;
  const calleeName = `at${suffix}`;
  const callerCookie = await register(callerName);
  const calleeCookie = await register(calleeName);
  const callerSocket = await connect(callerCookie);
  const calleeSocket = await connect(calleeCookie);
  const reserveResponse = await request("/billing/reserve", {
    method: "POST",
    headers: { cookie: callerCookie },
    body: JSON.stringify({ accepted: true, idempotencyKey: `reserve-${suffix}` }),
  });
  assert.equal(reserveResponse.status, 201, await reserveResponse.clone().text());

  t.after(async () => {
    callerSocket.close();
    calleeSocket.close();
    await Promise.allSettled([
      request("/auth/me", { method: "DELETE", headers: { cookie: callerCookie } }),
      request("/auth/me", { method: "DELETE", headers: { cookie: calleeCookie } }),
    ]);
  });

  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const deviceId = `device_${suffix}_secure`;
  const keyResponse = await request("/messages/e2e/key", {
    method: "PUT",
    headers: { cookie: calleeCookie },
    body: JSON.stringify({ deviceId, publicKey: publicKey.export({ format: "jwk" }) }),
  });
  assert.equal(keyResponse.status, 200, await keyResponse.clone().text());
  const key = await keyResponse.json();

  const callId = `call_${suffix}`;
  const readyPromise = waitFor(callerSocket, "call-ready");
  const incomingPromise = waitFor(calleeSocket, "call-incoming");
  callerSocket.send(JSON.stringify({
    type: "call-offer",
    offer: null,
    to: calleeName,
    callId,
    video: true,
    e2e: {
      devices: {
        [deviceId]: {
          wrappedSecret: "x".repeat(256),
          fingerprint: key.fingerprint,
        },
      },
    },
  }));

  const [ready, incoming] = await Promise.all([readyPromise, incomingPromise]);
  assert.equal(ready.callId, callId);
  assert.equal(incoming.callId, callId);

  const tokenResponse = await request(`/rtc/agora-token?channel=${encodeURIComponent(callId)}`, {
    headers: { cookie: callerCookie },
  });
  assert.notEqual(tokenResponse.status, 403, await tokenResponse.clone().text());
  assert.ok(
    tokenResponse.status === 200 || tokenResponse.status === 503,
    `expected configured token issuance or an explicit configuration response, got ${tokenResponse.status}`,
  );

  callerSocket.send(JSON.stringify({ type: "call-end", to: calleeName, callId }));
});