import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { createClipPlaybackRouter, publicAvatarUrl, type PlaybackClip } from "./clip-playback.js";
import { signClipPlayback, CLIP_PLAYBACK_TTL_MS } from "../lib/clip-playback.js";

test("code playback exposes pending state then a direct URL, never private object references", async () => {
  let row: PlaybackClip | null = {
    id: 12, code: "HELX-123456", title: "A song", original_name: "A song.mp3",
    duration_sec: 86400, size_bytes: "2147483648", created_at: "2026-09-18T12:00:00Z",
    content_type: "audio/mp4", processing_status: "queued", object_name: "private-original",
    user_id: 8, username: "producer", like_count: "3", comment_count: "2", liked_by_viewer: false,
    save_count: "4", share_count: "5", saved_by_viewer: true, avatar_url: null,
  };
  let signed = 0, lookup = 0, unavailable = false;
  const warnings: unknown[] = [];
  const app = express();
  app.use("/api", createClipPlaybackRouter({
    async find(code, viewerId) { lookup++; assert.equal(code, "HELX-123456"); assert.equal(viewerId, null); return row; },
    async sign(filename) {
      signed++; assert.equal(filename, "private-original");
      if (unavailable) throw new Error("Signing offline");
      return { url: "https://storage.googleapis.com/test/derived?signature=test", urlExpiresAt: "2026-09-19T14:00:00Z" };
    },
    log: error => warnings.push(error),
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/clip/by-code/`;
  try {
    assert.equal((await fetch(base + "invalid")).status, 404);
    assert.equal(lookup, 0);
    const response = await fetch(base + row.code);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const pending = await response.json() as { clip: Record<string, unknown> };
    assert.equal(pending.clip.url, null);
    assert.equal(pending.clip.processingStatus, "queued");
    assert.equal(pending.clip.size, 2147483648);
    assert.equal(pending.clip.originalName, "A song.mp3");
    assert.equal(pending.clip.id, 12);
    assert.deepEqual(pending.clip.author, { id: 8, username: "producer", avatarUrl: null });
    assert.equal(pending.clip.isOwner, false);
    assert.equal(pending.clip.likeCount, 3);
    assert.equal(pending.clip.commentCount, 2);
    assert.equal(pending.clip.saved, true);
    assert.equal(pending.clip.saveCount, 4);
    assert.equal(pending.clip.shareCount, 5);
    assert.equal("object_name" in pending.clip, false);
    assert.equal(signed, 0);
    row.processing_status = "ready";
    const ready = await (await fetch(base + row.code)).json() as { clip: Record<string, unknown> };
    assert.match(String(ready.clip.url), /^https:\/\/storage\.googleapis\.com\//);
    assert.equal(signed, 1);
    row.processing_status = "failed";
    const failed = await (await fetch(base + row.code)).json() as { clip: Record<string, unknown> };
    assert.equal(failed.clip.url, null);
    assert.equal(signed, 1);
    row.processing_status = "unchanged";
    unavailable = true;
    assert.equal((await fetch(base + row.code)).status, 503);
    assert.equal(warnings.length, 1);
    row = null; // Production lookup also maps frozen rows to null.
    assert.equal((await fetch(base + "HELX-123456")).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("playback signs GET using the real Replit sidecar contract, with no invented public bucket URL", async () => {
  const old = process.env.PRIVATE_OBJECT_DIR;
  process.env.PRIVATE_OBJECT_DIR = "/test-bucket/private";
  const before = Date.now();
  try {
    const signed = await signClipPlayback("derived.mp4", async (url, options) => {
      assert.equal(url, "http://127.0.0.1:1106/object-storage/signed-object-url");
      assert.equal(options?.method, "POST");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.bucket_name, "test-bucket");
      assert.equal(body.object_name, "private/clips/derived.mp4");
      assert.equal(body.method, "GET");
      assert.ok(Date.parse(body.expires_at) >= before + CLIP_PLAYBACK_TTL_MS);
      return Response.json({ signed_url: "https://storage.googleapis.com/test-bucket/private/clips/derived.mp4?X-Goog-Signature=test" });
    });
    assert.match(signed.url, /X-Goog-Signature=/);
    await assert.rejects(signClipPlayback("derived.mp4", async () => new Response("", { status: 503 })), /unavailable/);
    await assert.rejects(signClipPlayback("derived.mp4", async () => Response.json({})), /did not return/);
    await assert.rejects(signClipPlayback("derived.mp4", async () => Response.json({ signed_url: "https://attacker.invalid/" })), /unsupported/);
  } finally {
    if (old === undefined) delete process.env.PRIVATE_OBJECT_DIR;
    else process.env.PRIVATE_OBJECT_DIR = old;
  }
});

test("clip author avatars only expose bounded public web URLs", () => {
  assert.equal(publicAvatarUrl(" https://cdn.example/avatar.png "), "https://cdn.example/avatar.png");
  assert.equal(publicAvatarUrl("/api/media/avatar/7"), "/api/media/avatar/7");
  assert.equal(publicAvatarUrl("javascript:alert(1)"), null);
  assert.equal(publicAvatarUrl("//attacker.example/avatar.png"), null);
  assert.equal(publicAvatarUrl("x".repeat(2049)), null);
});