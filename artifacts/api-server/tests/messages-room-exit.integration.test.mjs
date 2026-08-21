import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const apiBaseUrl = (
  process.env.API_BASE_URL ?? "http://localhost:80/api"
).replace(/\/$/, "");

// Reuse the database package's declared pg dependency without adding a second
// test-only copy to the API artifact.
const requireFromDb = createRequire(
  new URL("../../../lib/db/package.json", import.meta.url),
);
const { Client } = requireFromDb("pg");

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
      ...options.headers,
    },
  });
}

async function assertStatus(response, expected) {
  const errorBody =
    response.status === expected ? undefined : await response.text();
  assert.equal(response.status, expected, errorBody);
}

async function register(username) {
  const response = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username,
      password: "disposable-conversation-password",
      birthDate: "1990-01-01",
    }),
  });
  await assertStatus(response, 201);
  return sessionCookie(response);
}

async function listRooms(cookie) {
  const response = await request("/messages/rooms", {
    headers: { cookie },
  });
  await assertStatus(response, 200);
  return response.json();
}

test("leaving a direct conversation only removes the authenticated member", async (t) => {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const leavingUsername = `leaver${suffix}`;
  const remainingUsername = `keeper${suffix}`;
  const messageContent = `Conversation retention regression ${suffix}`;

  const leavingCookie = await register(leavingUsername);
  const remainingCookie = await register(remainingUsername);

  t.after(async () => {
    await Promise.allSettled([
      request("/auth/me", {
        method: "DELETE",
        headers: { cookie: leavingCookie },
      }),
      request("/auth/me", {
        method: "DELETE",
        headers: { cookie: remainingCookie },
      }),
    ]);
  });

  const created = await request("/messages/rooms", {
    method: "POST",
    headers: { cookie: leavingCookie },
    body: JSON.stringify({ targetUsername: remainingUsername }),
  });
  await assertStatus(created, 201);
  const createdBody = await created.json();
  const roomId = createdBody.room?.id;
  assert.equal(typeof roomId, "number");

  const sent = await request(`/messages/rooms/${roomId}/send`, {
    method: "POST",
    headers: { cookie: leavingCookie },
    body: JSON.stringify({ content: messageContent }),
  });
  await assertStatus(sent, 201);

  const leavingRoomsBefore = await listRooms(leavingCookie);
  const remainingRoomsBefore = await listRooms(remainingCookie);
  assert.ok(leavingRoomsBefore.rooms.some((room) => room.id === roomId));
  assert.ok(remainingRoomsBefore.rooms.some((room) => room.id === roomId));

  const firstExit = await request(`/messages/rooms/${roomId}`, {
    method: "DELETE",
    headers: { cookie: leavingCookie },
  });
  await assertStatus(firstExit, 200);
  assert.deepEqual(await firstExit.json(), {
    deleted: true,
    roomDeleted: false,
  });

  const leavingRoomsAfter = await listRooms(leavingCookie);
  assert.ok(
    leavingRoomsAfter.rooms.every((room) => room.id !== roomId),
    "the leaving citizen must no longer receive the room in their list",
  );

  const leavingRead = await request(`/messages/rooms/${roomId}`, {
    headers: { cookie: leavingCookie },
  });
  await assertStatus(leavingRead, 403);

  const remainingRoomsAfter = await listRooms(remainingCookie);
  assert.ok(
    remainingRoomsAfter.rooms.some((room) => room.id === roomId),
    "the remaining citizen must keep the room in their list",
  );

  const remainingRead = await request(`/messages/rooms/${roomId}`, {
    headers: { cookie: remainingCookie },
  });
  await assertStatus(remainingRead, 200);
  const remainingBody = await remainingRead.json();
  assert.equal(remainingBody.room.id, roomId);
  assert.ok(
    remainingBody.messages.some(
      (message) => message.content === messageContent,
    ),
    "the remaining citizen must keep the conversation messages",
  );

  const finalExit = await request(`/messages/rooms/${roomId}`, {
    method: "DELETE",
    headers: { cookie: remainingCookie },
  });
  await assertStatus(finalExit, 200);
  assert.deepEqual(await finalExit.json(), {
    deleted: true,
    roomDeleted: true,
  });

  assert.ok(
    process.env.DATABASE_URL,
    "DATABASE_URL is required for cleanup verification",
  );
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(() => client.end());

  const cleanup = await client.query(
    `SELECT
       (SELECT count(*)::int FROM dm_rooms WHERE id = $1) AS rooms,
       (SELECT count(*)::int FROM dm_room_members WHERE room_id = $1) AS memberships,
       (SELECT count(*)::int FROM dm_messages WHERE room_id = $1) AS messages`,
    [roomId],
  );
  assert.deepEqual(cleanup.rows[0], {
    rooms: 0,
    memberships: 0,
    messages: 0,
  });
});
