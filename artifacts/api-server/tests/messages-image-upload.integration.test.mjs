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
  const apiRelativePath = path.startsWith("/api/") ? path.slice(4) : path;
  return fetch(`${apiBaseUrl}${apiRelativePath}`, {
    redirect: "manual",
    ...options,
    headers: { ...options.headers },
  });
}

async function assertStatus(response, expected) {
  const errorBody = response.status === expected ? undefined : await response.text();
  assert.equal(response.status, expected, errorBody);
}

async function register(username) {
  const response = await request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username,
      password: `upload-check-${username}`,
      birthDate: "1990-01-01",
    }),
  });
  await assertStatus(response, 201);
  return sessionCookie(response);
}

function uploadForm(bytes, type, name) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), name);
  return form;
}

test("encrypted image upload enforces room authorization and streaming bounds", async (t) => {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const ownerCookie = await register(`iuo${suffix}`);
  const outsiderCookie = await register(`iux${suffix}`);
  let roomId;
  let messageId;

  t.after(async () => {
    if (messageId && roomId) {
      await request(`/messages/rooms/${roomId}/messages/${messageId}`, {
        method: "DELETE",
        headers: { cookie: ownerCookie },
      }).catch(() => {});
    }
    if (roomId) {
      await request(`/messages/rooms/${roomId}`, {
        method: "DELETE",
        headers: { cookie: ownerCookie },
      }).catch(() => {});
    }
    await Promise.allSettled([
      request("/auth/me", { method: "DELETE", headers: { cookie: ownerCookie } }),
      request("/auth/me", { method: "DELETE", headers: { cookie: outsiderCookie } }),
    ]);
  });

  const roomResponse = await request("/messages/rooms", {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ type: "group", roomName: `Upload check ${suffix}` }),
  });
  await assertStatus(roomResponse, 201);
  roomId = (await roomResponse.json()).room.id;

  // Deliberately not valid multipart: a 403 demonstrates membership was
  // rejected before multer attempted to parse/consume the upload.
  const forbidden = await request(`/messages/upload?roomId=${roomId}&kind=image`, {
    method: "POST",
    headers: {
      cookie: outsiderCookie,
      "content-type": "multipart/form-data; boundary=not-consumed",
    },
    body: "this body must not be parsed",
  });
  await assertStatus(forbidden, 403);

  const ciphertext = Uint8Array.from({ length: 96 }, (_, index) => (index * 17) % 256);
  const uploaded = await request(`/messages/upload?roomId=${roomId}&kind=image`, {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: uploadForm(ciphertext, "application/octet-stream", "ciphertext.bin"),
  });
  await assertStatus(uploaded, 200);
  const uploadBody = await uploaded.json();
  assert.equal(uploadBody.kind, "image");
  assert.match(uploadBody.url, /^\/api\/messages\/files\/[A-Za-z0-9._-]+$/);

  const sent = await request(`/messages/rooms/${roomId}/send`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({
      content: `Encrypted image integration cleanup ${suffix}`,
      fileUrl: uploadBody.url,
      type: "image",
    }),
  });
  await assertStatus(sent, 201);
  messageId = (await sent.json()).message.id;

  const downloaded = await request(uploadBody.url, {
    headers: { cookie: ownerCookie },
  });
  await assertStatus(downloaded, 200);
  assert.equal(downloaded.headers.get("content-type"), "application/octet-stream");
  assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), ciphertext);

  const encryptedOversize = new Uint8Array(5 * 1024 * 1024 + 17);
  const rejectedEncrypted = await request(`/messages/upload?roomId=${roomId}&kind=image`, {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: uploadForm(encryptedOversize, "application/octet-stream", "too-large.enc"),
  });
  await assertStatus(rejectedEncrypted, 413);

  const rawImageOversize = new Uint8Array(5 * 1024 * 1024 + 1);
  const rejectedRaw = await request("/messages/upload", {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: uploadForm(rawImageOversize, "image/png", "too-large.png"),
  });
  await assertStatus(rejectedRaw, 413);

  const deleted = await request(`/messages/rooms/${roomId}/messages/${messageId}`, {
    method: "DELETE",
    headers: { cookie: ownerCookie },
  });
  await assertStatus(deleted, 200);
  messageId = undefined;

  const inaccessibleAfterDelete = await request(uploadBody.url, {
    headers: { cookie: ownerCookie },
  });
  await assertStatus(inaccessibleAfterDelete, 403);
});