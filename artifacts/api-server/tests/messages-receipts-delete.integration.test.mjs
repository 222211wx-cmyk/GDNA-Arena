import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";

const apiBaseUrl = (process.env.API_BASE_URL ?? "http://localhost:80/api").replace(/\/$/, "");
const wsUrl = `${apiBaseUrl.replace(/^http/, "ws")}/ws`;

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
      password: "disposable-messenger-test-pw",
      birthDate: "1990-01-01",
    }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  return sessionCookie(response);
}

function openSocket(cookie) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, { headers: { cookie } });
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket registration timed out"));
    }, 8_000);
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "register" }));
    });
    socket.on("message", raw => {
      const message = JSON.parse(String(raw));
      if (message.type === "registered") {
        clearTimeout(timeout);
        resolve(socket);
      }
    });
    socket.on("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForEvent(socket, type, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`Timed out waiting for ${type}`));
    }, 8_000);
    function onMessage(raw) {
      const message = JSON.parse(String(raw));
      if (message.type !== type || !predicate(message)) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    }
    socket.on("message", onMessage);
  });
}

function silentWav() {
  const sampleRate = 8_000;
  const samples = 800;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

test("audio access, read receipts, and delete-for-everyone work for both citizens", async t => {
  const suffix = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
  const senderName = `rs${suffix}`;
  const readerName = `rr${suffix}`;
  const senderCookie = await register(senderName);
  const readerCookie = await register(readerName);
  const senderSocket = await openSocket(senderCookie);
  const readerSocket = await openSocket(readerCookie);

  t.after(async () => {
    senderSocket.close();
    readerSocket.close();
    await Promise.allSettled([
      request("/auth/me", { method: "DELETE", headers: { cookie: senderCookie } }),
      request("/auth/me", { method: "DELETE", headers: { cookie: readerCookie } }),
    ]);
  });

  const roomResponse = await request("/messages/rooms", {
    method: "POST",
    headers: { cookie: senderCookie },
    body: JSON.stringify({ targetUsername: readerName }),
  });
  assert.equal(roomResponse.status, 201, await roomResponse.clone().text());
  const { room } = await roomResponse.json();

  const readerDelivery = waitForEvent(
    readerSocket,
    "chat-message",
    event => event.roomId === room.id,
  );
  const sentResponse = await request(`/messages/rooms/${room.id}/send`, {
    method: "POST",
    headers: { cookie: senderCookie },
    body: JSON.stringify({ content: `receipt test ${suffix}` }),
  });
  assert.equal(sentResponse.status, 201, await sentResponse.clone().text());
  const sent = (await sentResponse.json()).message;
  const delivered = await readerDelivery;
  assert.equal(delivered.message.id, sent.id);

  const senderReadReceipt = waitForEvent(
    senderSocket,
    "chat-read",
    event => event.roomId === room.id && event.readerUserId !== sent.userId,
  );
  const readerHistory = await request(`/messages/rooms/${room.id}`, {
    headers: { cookie: readerCookie },
  });
  assert.equal(readerHistory.status, 200, await readerHistory.clone().text());
  const receipt = await senderReadReceipt;
  assert.ok(receipt.readAt, "read receipt must contain the opened timestamp");

  const readerDeletion = waitForEvent(
    readerSocket,
    "chat-message-deleted",
    event => event.roomId === room.id && event.messageId === sent.id,
  );
  const deleteResponse = await request(`/messages/rooms/${room.id}/messages/${sent.id}`, {
    method: "DELETE",
    headers: { cookie: senderCookie },
  });
  assert.equal(deleteResponse.status, 200, await deleteResponse.clone().text());
  await readerDeletion;

  const historyAfterDelete = await request(`/messages/rooms/${room.id}`, {
    headers: { cookie: readerCookie },
  });
  assert.equal(historyAfterDelete.status, 200);
  const history = await historyAfterDelete.json();
  assert.equal(history.messages.some(message => message.id === sent.id), false);

  const form = new FormData();
  form.append("file", new Blob([silentWav()], { type: "audio/wav" }), "voice-note.wav");
  const uploadResponse = await fetch(`${apiBaseUrl}/messages/upload`, {
    method: "POST",
    headers: { cookie: senderCookie },
    body: form,
  });
  assert.equal(uploadResponse.status, 200, await uploadResponse.clone().text());
  const uploaded = await uploadResponse.json();
  assert.equal(uploaded.kind, "audio");

  const audioDelivery = waitForEvent(
    readerSocket,
    "chat-message",
    event => event.roomId === room.id && event.message?.type === "audio",
  );
  const audioSendResponse = await request(`/messages/rooms/${room.id}/send`, {
    method: "POST",
    headers: { cookie: senderCookie },
    body: JSON.stringify({ audioUrl: uploaded.url, type: "audio" }),
  });
  assert.equal(audioSendResponse.status, 201, await audioSendResponse.clone().text());
  const audioMessage = (await audioSendResponse.json()).message;
  await audioDelivery;

  for (const cookie of [senderCookie, readerCookie]) {
    const audioResponse = await fetch(`${apiBaseUrl}${uploaded.url.replace(/^\/api/, "")}`, {
      headers: { cookie },
    });
    assert.equal(audioResponse.status, 200, await audioResponse.clone().text());
    assert.match(audioResponse.headers.get("content-type") ?? "", /^audio\/wav/);
    assert.ok((await audioResponse.arrayBuffer()).byteLength > 44);
  }

  const deleteAudioResponse = await request(`/messages/rooms/${room.id}/messages/${audioMessage.id}`, {
    method: "DELETE",
    headers: { cookie: senderCookie },
  });
  assert.equal(deleteAudioResponse.status, 200, await deleteAudioResponse.clone().text());
});