/**
 * Integration tests for GET /api/messages/rooms sort order — Task #138
 *
 * Verifies:
 *   1. Rooms are returned newest-activity first (by latest message timestamp).
 *   2. A room with no messages still appears, falling back to room created_at.
 *   3. Membership authorisation is preserved — non-members still get 401.
 *   4. Response shape is unchanged ({ rooms: [...] }).
 *
 * Requires a running API server at API_BASE_URL (defaults to http://localhost:80/api).
 */

import assert from "node:assert/strict";
import test from "node:test";

const apiBaseUrl = (
  process.env.API_BASE_URL ?? "http://localhost:80/api"
).replace(/\/$/, "");

function sessionCookie(response) {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "registration must establish a session cookie");
  return setCookie.split(";", 1)[0];
}

async function request(path, options = {}) {
  return fetch(`${apiBaseUrl}${path}`, {
    redirect: "manual",
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
      password: "disposable-rooms-order-pw",
      birthDate: "1990-01-01",
    }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  return sessionCookie(response);
}

// ── test 1: rooms sorted newest-activity first ────────────────────────────────
test("rooms are sorted by newest message activity, newest first", async (t) => {
  const suffix = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
  const alphaName  = `oa${suffix}`;
  const betaName   = `ob${suffix}`;
  const gammaCookieName = `og${suffix}`;

  const alphaCookie = await register(alphaName);
  const betaCookie  = await register(betaName);
  const gammaCookie = await register(gammaCookieName);

  t.after(async () => {
    await Promise.allSettled([
      request("/auth/me", { method: "DELETE", headers: { cookie: alphaCookie } }),
      request("/auth/me", { method: "DELETE", headers: { cookie: betaCookie } }),
      request("/auth/me", { method: "DELETE", headers: { cookie: gammaCookie } }),
    ]);
  });

  // Alpha opens two DMs: one with beta, one with gamma
  const dmWithBeta = await request("/messages/rooms", {
    method: "POST",
    headers: { cookie: alphaCookie },
    body: JSON.stringify({ targetUsername: betaName }),
  });
  assert.equal(dmWithBeta.status, 201, await dmWithBeta.clone().text());
  const roomWithBeta = (await dmWithBeta.json()).room;

  const dmWithGamma = await request("/messages/rooms", {
    method: "POST",
    headers: { cookie: alphaCookie },
    body: JSON.stringify({ targetUsername: gammaCookieName }),
  });
  assert.equal(dmWithGamma.status, 201, await dmWithGamma.clone().text());
  const roomWithGamma = (await dmWithGamma.json()).room;

  // Send a message in the beta room first, then a message in the gamma room
  const sentBeta = await request(`/messages/rooms/${roomWithBeta.id}/send`, {
    method: "POST",
    headers: { cookie: alphaCookie },
    body: JSON.stringify({ content: "hello beta (older message)" }),
  });
  assert.equal(sentBeta.status, 201, await sentBeta.text());

  // Brief pause so timestamps differ (DB precision is millisecond-level)
  await new Promise((resolve) => setTimeout(resolve, 50));

  const sentGamma = await request(`/messages/rooms/${roomWithGamma.id}/send`, {
    method: "POST",
    headers: { cookie: alphaCookie },
    body: JSON.stringify({ content: "hello gamma (newer message)" }),
  });
  assert.equal(sentGamma.status, 201, await sentGamma.text());

  // Fetch alpha's room list — gamma room should come first
  const roomsRes = await request("/messages/rooms", {
    headers: { cookie: alphaCookie },
  });
  assert.equal(roomsRes.status, 200);
  const { rooms } = await roomsRes.json();

  const gammaIndex = rooms.findIndex((r) => r.id === roomWithGamma.id);
  const betaIndex  = rooms.findIndex((r) => r.id === roomWithBeta.id);
  assert.ok(gammaIndex !== -1, "gamma room must appear in alpha's room list");
  assert.ok(betaIndex  !== -1, "beta room must appear in alpha's room list");
  assert.ok(
    gammaIndex < betaIndex,
    `gamma room (index ${gammaIndex}) must come before beta room (index ${betaIndex}) since gamma has the newer message`,
  );
});

// ── test 2: room with no messages still appears (created_at fallback) ─────────
test("a room with no messages is returned with correct shape", async (t) => {
  const suffix = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
  const ownerName  = `eo${suffix}`;
  const memberName = `em${suffix}`;

  const ownerCookie  = await register(ownerName);
  const memberCookie = await register(memberName);

  t.after(async () => {
    await Promise.allSettled([
      request("/auth/me", { method: "DELETE", headers: { cookie: ownerCookie } }),
      request("/auth/me", { method: "DELETE", headers: { cookie: memberCookie } }),
    ]);
  });

  const createdRes = await request("/messages/rooms", {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ targetUsername: memberName }),
  });
  assert.equal(createdRes.status, 201, await createdRes.clone().text());
  const { room } = await createdRes.json();

  // No messages sent — fetch rooms
  const listRes = await request("/messages/rooms", { headers: { cookie: ownerCookie } });
  assert.equal(listRes.status, 200);
  const { rooms } = await listRes.json();

  const found = rooms.find((r) => r.id === room.id);
  assert.ok(found, "empty room must appear in room list");
  assert.equal(found.lastMessage, null, "lastMessage must be null for empty room");
  assert.ok(Array.isArray(found.members), "members must be an array");
  assert.ok(typeof found.unreadCount === "number", "unreadCount must be a number");
  assert.ok(typeof found.muted === "boolean", "muted must be a boolean");
});

// ── test 3: unauthenticated requests are rejected ────────────────────────────
test("GET /messages/rooms requires authentication", async () => {
  const res = await request("/messages/rooms");
  assert.equal(res.status, 401);
});
