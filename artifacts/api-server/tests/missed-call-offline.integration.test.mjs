import assert from "node:assert/strict";
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
      password: "disposable-missed-call-pw",
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

test("an offline citizen receives a durable missed-call notification", async t => {
  const suffix = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
  const callerName = `mc${suffix}`;
  const calleeName = `mo${suffix}`;
  const callerCookie = await register(callerName);
  const calleeCookie = await register(calleeName);
  const callerSocket = await connect(callerCookie);

  t.after(async () => {
    callerSocket.close();
    await Promise.allSettled([
      request("/auth/me", { method: "DELETE", headers: { cookie: callerCookie } }),
      request("/auth/me", { method: "DELETE", headers: { cookie: calleeCookie } }),
    ]);
  });

  const unavailable = waitFor(callerSocket, "call-unavailable");
  callerSocket.send(JSON.stringify({
    type: "call-offer",
    to: calleeName,
    callId: `offline-${suffix}`,
    video: false,
    e2e: {},
  }));
  const event = await unavailable;
  assert.equal(event.missedLogged, true);

  const unavailableVideo = waitFor(callerSocket, "call-unavailable");
  callerSocket.send(JSON.stringify({
    type: "call-offer",
    to: calleeName,
    callId: `offline-video-${suffix}`,
    video: true,
    e2e: {},
  }));
  const videoEvent = await unavailableVideo;
  assert.equal(videoEvent.missedLogged, true);

  const notificationsResponse = await request("/notifications", {
    headers: { cookie: calleeCookie },
  });
  assert.equal(notificationsResponse.status, 200);
  const notificationData = await notificationsResponse.json();
  const missed = notificationData.notifications.filter(item => item.type === "missed_call");
  assert.equal(missed.length, 2, "offline callee must receive audio and video missed-call notifications");
  assert.ok(missed.every(item => new RegExp(callerName).test(item.body)));
  assert.ok(missed.every(item => item.linkPath === "/messages"));
  assert.ok(missed.some(item => item.body.includes("الفيديو")));

  const historyResponse = await request("/social/v2/call-history", {
    headers: { cookie: calleeCookie },
  });
  assert.equal(historyResponse.status, 200);
  const historyData = await historyResponse.json();
  const history = historyData.records ?? [];
  assert.ok(
    history.some(item =>
      item.callerUsername === callerName &&
      item.calleeUsername === calleeName &&
      item.status === "missed" &&
      item.callType === "audio"),
    "missed call must be visible in the callee call history",
  );
  assert.ok(
    history.some(item =>
      item.callerUsername === callerName &&
      item.calleeUsername === calleeName &&
      item.status === "missed" &&
      item.callType === "video"),
    "missed video call must be visible in the callee call history",
  );
});