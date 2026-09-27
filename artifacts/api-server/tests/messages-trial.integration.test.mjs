import assert from "node:assert/strict";
import test from "node:test";

const base = (process.env.API_BASE_URL ?? "http://localhost:80/api").replace(/\/$/, "");
const request = (path, cookie, method = "GET", body) => fetch(`${base}${path}`, {
  method,
  headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test("ten lifetime sends across rooms/devices; no read or upload charge", async t => {
  const suffix = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 7)}`;
  const names = ["triala", "trialb", "trialc"].map(name => name + suffix);
  const cookies = [];
  for (const username of names) {
    const response = await request("/auth/register", undefined, "POST", {
      username, password: "disposable-trial-test-password", birthDate: "1990-01-01",
    });
    assert.equal(response.status, 201, await response.clone().text());
    cookies.push(response.headers.get("set-cookie")?.split(";", 1)[0]);
    assert.ok(cookies.at(-1));
  }
  t.after(async () => {
    await Promise.allSettled(cookies.map(cookie => request("/auth/me", cookie, "DELETE")));
  });
  const secondSession = await request("/auth/login", undefined, "POST", {
    username: names[0], password: "disposable-trial-test-password",
  });
  assert.equal(secondSession.status, 200, await secondSession.clone().text());
  const secondCookie = secondSession.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(secondCookie, "second device establishes its own session");
  const roomIds = [];
  for (const targetUsername of names.slice(1)) {
    const response = await request("/messages/rooms", cookies[0], "POST", { targetUsername });
    assert.ok([200, 201].includes(response.status), await response.clone().text());
    roomIds.push((await response.json()).room.id);
  }
  const status = async () => {
    const response = await request("/messages/subscription", cookies[0]);
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.deepEqual(await status(), { hasActiveSubscription: false, canSendMessages: true, freeMessagesRemaining: 10 });

  const invalid = await request(`/messages/rooms/${roomIds[0]}/send`, cookies[0], "POST", { content: "" });
  assert.equal(invalid.status, 400);
  assert.equal((await status()).freeMessagesRemaining, 10);

  // Eleven concurrent requests on two rooms must produce exactly ten inserts.
  const sends = await Promise.all(Array.from({ length: 11 }, (_, i) =>
    request(`/messages/rooms/${roomIds[i % 2]}/send`, i % 2 ? secondCookie : cookies[0], "POST",
      { content: `Hello friend, this is our conversation number ${i + 1} today.` })));
  assert.equal(sends.filter(response => response.status === 201).length, 10,
    await Promise.all(sends.map(response => response.clone().text())));
  const denied = sends.find(response => response.status === 403);
  assert.ok(denied);
  assert.deepEqual(await denied.json(), {
    code: "MESSAGING_SUBSCRIPTION_REQUIRED", error: "Contactez l'AMIS pour activer",
  });
  assert.deepEqual(await status(), { hasActiveSubscription: false, canSendMessages: false, freeMessagesRemaining: 0 });

  for (const roomId of roomIds) {
    const read = await request(`/messages/rooms/${roomId}`, cookies[0]);
    assert.equal(read.status, 200, "history remains accessible after exhaustion");
    const messages = (await read.json()).messages;
    assert.ok(messages.length > 0);
    const deleted = await request(`/messages/rooms/${roomId}/messages/${messages.find(m => m.userId)?.id}`,
      cookies[0], "DELETE");
    assert.ok([200, 204].includes(deleted.status), await deleted.clone().text());
    assert.equal((await status()).freeMessagesRemaining, 0, "deleting a message does not reset the trial");
  }
  const upload = await request("/messages/upload", cookies[0], "POST");
  assert.equal(upload.status, 403, "uploads refuse when allowance exhausted");
  assert.equal((await status()).freeMessagesRemaining, 0);
});