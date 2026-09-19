import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";

const base = (process.env.API_BASE_URL ?? "http://localhost:80/api").replace(/\/$/, "");
async function request(path, cookie, body, method = "POST") {
  return fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function register(username) {
  const response = await request("/auth/register", null, { username, password: "canonical-private-test-password", birthDate: "1990-01-01" });
  assert.equal(response.status, 201, await response.clone().text());
  return response.headers.get("set-cookie").split(";", 1)[0];
}
function next(socket, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("message", listener); reject(new Error(`Missing ${type}`)); }, 8000);
    function listener(raw) {
      const data = JSON.parse(String(raw));
      if (data.type !== type) return;
      clearTimeout(timer); socket.off("message", listener); resolve(data);
    }
    socket.on("message", listener);
  });
}
test("canonical pair survives concurrent reversed opens; typing/reports require membership", async t => {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const a = `ca${suffix}`, b = `cb${suffix}`, outsider = `co${suffix}`;
  const cookies = [];
  t.after(async () => { await Promise.allSettled(cookies.map(cookie => request("/auth/me", cookie, undefined, "DELETE"))); });
  for (const name of [a, b, outsider]) cookies.push(await register(name));
  const responses = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    request("/messages/rooms", cookies[i % 2], { targetUsername: i % 2 ? a : b })));
  for (const response of responses) assert.ok(response.ok, await response.clone().text());
  const ids = await Promise.all(responses.map(async response => (await response.json()).room.id));
  assert.equal(new Set(ids).size, 1, "parallel requests must preserve one numeric room ID");
  const roomId = ids[0];
  assert.equal(typeof roomId, "number");
  assert.equal((await request(`/messages/rooms/${roomId}/typing`, cookies[2], { typing: true })).status, 403);
  assert.equal((await request(`/messages/rooms/${roomId}/report`, cookies[2], { reason: "Unauthorized report" })).status, 403);
  assert.equal((await request(`/messages/rooms/${roomId}/typing`, cookies[0], { typing: "private text" })).status, 400);
  const socket = new WebSocket(`${base.replace(/^http/, "ws")}/ws`, { headers: { cookie: cookies[1] } });
  t.after(() => socket.close());
  const registered = next(socket, "registered");
  socket.on("open", () => socket.send(JSON.stringify({ type: "register" })));
  await registered;
  const typing = next(socket, "chat-typing");
  assert.equal((await request(`/messages/rooms/${roomId}/typing`, cookies[0], { typing: true })).status, 200);
  const event = await typing;
  assert.equal(event.roomId, roomId);
  assert.equal(event.typing, true);
  assert.equal(event.content, undefined, "typing never carries draft plaintext");
  assert.equal((await request(`/messages/rooms/${roomId}/report`, cookies[0], { reason: "Please review this conversation" })).status, 201);
  assert.equal((await request("/messages/safety-reports", cookies[0], undefined, "GET")).status, 403);
});

test("recipient visibility governs spoofed direct opens and existing-room access after revocation", async t => {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const senderName = `ps${suffix}`, recipientName = `pr${suffix}`;
  const cookies = [];
  t.after(async () => { await Promise.allSettled(cookies.map(cookie => request("/auth/me", cookie, undefined, "DELETE"))); });
  cookies.push(await register(senderName), await register(recipientName));
  const [sender, recipient] = cookies;
  async function visibility(value) {
    const response = await request("/citizen-profiles/me", recipient, { visibility: value }, "PUT");
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  // No-profile identity intentionally remains messageable under canonical projection.
  const initial = await request("/messages/rooms", sender, { targetUsername: recipientName });
  assert.equal(initial.status, 201, await initial.clone().text());
  const { room } = await initial.json();
  const profile = await visibility("private");
  for (const body of [{ targetUsername: recipientName }, { targetUserId: profile.userId }]) {
    const denied = await request("/messages/rooms", sender, body);
    assert.equal(denied.status, 403, "neither username nor numeric ID may bypass private visibility");
  }
  assert.equal((await request(`/messages/rooms/${room.id}`, sender, undefined, "GET")).status, 403);
  assert.equal((await request(`/messages/rooms/${room.id}/e2e-keys`, sender, undefined, "GET")).status, 403);
  assert.equal((await request(`/messages/rooms/${room.id}/send`, sender, { content: "Existing membership does not grant permission" })).status, 403);
  assert.equal((await request(`/messages/rooms/${room.id}/typing`, sender, { typing: true })).status, 403);
  await visibility("friends");
  assert.equal((await request(`/citizen-profiles/${recipientName}/follow`, sender, {})).status, 200);
  assert.equal((await request("/messages/rooms", sender, { targetUserId: profile.userId })).status, 403, "one-way follow is not friendship");
  assert.equal((await request(`/citizen-profiles/${senderName}/follow`, recipient, {})).status, 200);
  const restored = await request("/messages/rooms", sender, { targetUserId: profile.userId });
  assert.equal(restored.status, 200, await restored.clone().text());
  assert.equal((await restored.json()).room.id, room.id, "mutual friends reuse historical thread");
  assert.equal((await request(`/messages/rooms/${room.id}/typing`, sender, { typing: true })).status, 200);
  assert.equal((await request(`/messages/rooms/${room.id}`, sender, undefined, "GET")).status, 200);
  // Even established mutual friends cannot evade a later switch to private.
  await visibility("private");
  assert.equal((await request(`/messages/rooms/${room.id}/send`, sender, { content: "No contact after revocation" })).status, 403);
  assert.equal((await request(`/messages/rooms/${room.id}/typing`, sender, { typing: true })).status, 403);
});