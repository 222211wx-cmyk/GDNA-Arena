import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import type { AddressInfo } from "node:net";
import type { File, CreateWriteStreamOptions } from "@google-cloud/storage";
import test from "node:test";
import express, { type Request, type Response } from "express";
import {
  createSimpleClipUploadRouter, SIMPLE_CLIP_MAX_BYTES, SIMPLE_CLIP_TIMEOUT_MS,
  type SimpleClipUploadDependencies,
} from "./clip-simple-upload.js";
import { ClipUploadError } from "../lib/clip-upload-protocol.js";
import { createClipsFeedHandler } from "./clips-feed.js";

test("simple original upload: auth, GCS resumable chunk options, exact limit, cleanup, response contract", async () => {
  const options: CreateWriteStreamOptions[] = [];
  const objects = new Map<string, { size: number; hash: string }>();
  const committed = new Set<string>();
  const published: Parameters<SimpleClipUploadDependencies["publish"]>[0][] = [];
  let publishError: Error | undefined;
  let streamError = false;
  let committedThenError = false;
  const app = express();
  app.use((req, _res, next) => {
    if (req.header("X-Test-User")) (req as unknown as { session: { userId: number } }).session = { userId: 1 };
    next();
  });
  app.use("/api", createSimpleClipUploadRouter({
    file(name) {
      return {
        createWriteStream(writeOptions) {
          options.push(writeOptions!);
          const hash = createHash("sha256");
          let size = 0;
          return new Writable({
            write(chunk: Buffer, _encoding, cb) {
              if (streamError) { cb(new Error("Storage unavailable")); return; }
              hash.update(chunk); size += chunk.length; cb();
            },
            final(cb) { objects.set(name, { size, hash: hash.digest("hex") }); cb(); },
          }) as ReturnType<File["createWriteStream"]>;
        },
      };
    },
    async cleanup(name) { if (!committed.has(name)) objects.delete(name); },
    async publish(input) {
      if (publishError) throw publishError;
      const object = objects.get(input.filename);
      assert.ok(object, "publication requires a durable original");
      assert.equal(object.size, input.size);
      assert.equal(object.hash, input.sha256);
      committed.add(input.filename);
      if (committedThenError) throw new Error("Lost COMMIT acknowledgement");
      published.push(input);
      return { id: published.length, title: input.title, duration_sec: 61, thumb: null };
    },
    log() {},
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/clip/upload`;
  const post = async (size: number, config: {
    auth?: boolean; title?: string; field?: string; type?: string; filename?: string;
    purpose?: string; originalReference?: string;
    rightsHolderName?: string; rightsHolderRole?: string;
  } = {}) => {
    const form = new FormData();
    form.append(config.field ?? "file", new Blob([Buffer.alloc(size, 7)], { type: config.type ?? "video/mp4" }), config.filename ?? "original.mp4");
    if (config.title !== undefined) form.append("title", config.title);
    if (config.purpose !== undefined) form.append("purpose", config.purpose);
    if (config.originalReference !== undefined) form.append("originalReference", config.originalReference);
    if (config.rightsHolderName !== undefined) form.append("rightsHolderName", config.rightsHolderName);
    if (config.rightsHolderRole !== undefined) form.append("rightsHolderRole", config.rightsHolderRole);
    const response = await fetch(endpoint, { method: "POST", headers: config.auth === false ? {} : { "X-Test-User": "1" }, body: form });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await post(1024, { auth: false })).status, 401);
    assert.equal(options.length, 0, "anonymous bodies must never reach storage");
    const success = await post(1024, { title: "Uploaded original" });
    assert.equal(success.status, 200);
    assert.deepEqual(success.body, { ok: true, url: "/api/clips/stream/1", clip: { id: 1, title: "Uploaded original", duration_sec: 61, thumb: null } });
    assert.equal(options[0].resumable, true);
    assert.equal(options[0].chunkSize, 5 * 1024 * 1024);
    assert.equal(options[0].timeout, 300_000);
    assert.equal(SIMPLE_CLIP_TIMEOUT_MS, 300_000);
    assert.equal(options[0].preconditionOpts?.ifGenerationMatch, 0);
    const exact = await post(SIMPLE_CLIP_MAX_BYTES);
    assert.equal(exact.status, 200, JSON.stringify(exact.body));
    assert.equal(published.at(-1)?.size, SIMPLE_CLIP_MAX_BYTES);
    assert.equal(published.at(-1)?.title, "كليب", "title is optional");
    const declared = await post(1024, {
      purpose: "original", originalReference: "  archive registration  ",
      rightsHolderName: "  Studio Producer  ", rightsHolderRole: "producer",
    });
    assert.equal(declared.status, 200);
    assert.equal(published.at(-1)?.purpose, "original");
    assert.equal(published.at(-1)?.originalReference, "  archive registration  ",
      "the route forwards declarations for server-side trimming and validation");
    assert.equal(published.at(-1)?.rightsHolderName, "  Studio Producer  ");
    assert.equal(published.at(-1)?.rightsHolderRole, "producer");
    const tooLarge = await post(SIMPLE_CLIP_MAX_BYTES + 1);
    assert.equal(tooLarge.status, 413);
    assert.deepEqual(tooLarge.body, { error: "صغر الفيديو" });
    assert.equal(objects.size, 3, "oversize bytes are not retained or published");
    assert.equal((await post(10, { type: "text/plain" })).status, 415);
    assert.equal((await post(10, { field: "video" })).status, 400);
    assert.equal((await post(0)).status, 400);
    publishError = new ClipUploadError(400, "Duration below 60 seconds");
    assert.equal((await post(1024)).status, 400);
    assert.equal(objects.size, 3);
    publishError = new ClipUploadError(409, "First-owner registry rejected duplicate");
    assert.equal((await post(1024)).status, 409);
    assert.equal(objects.size, 3);
    publishError = undefined;
    streamError = true;
    assert.equal((await post(1024)).status, 500);
    streamError = false;
    committedThenError = true;
    assert.equal((await post(1024)).status, 500);
    assert.equal(objects.size, 4, "ambiguous commit cleanup preserves published original");
    committedThenError = false;
    const audioTooLarge = await post(SIMPLE_CLIP_MAX_BYTES + 1, { type: "audio/wav" });
    assert.equal(audioTooLarge.status, 413);
    assert.deepEqual(audioTooLarge.body, { error: "صغر الملف الصوتي" });
    assert.equal((await post(512, { type: "", filename: "voice.mp3" })).status, 200);
    assert.equal(published.at(-1)?.contentType, "audio/mpeg");
    for (const [type, normalized, extension] of [
      ["audio/mp3", "audio/mpeg", ".mp3"], ["audio/x-m4a", "audio/mp4", ".m4a"],
      ["audio/aac", "audio/aac", ".aac"], ["application/ogg", "audio/ogg", ".ogg"],
      ["audio/x-wav", "audio/wav", ".wav"], ["audio/webm", "audio/webm", ".webm"],
      ["audio/x-flac", "audio/flac", ".flac"],
    ]) {
      assert.equal((await post(512, { type })).status, 200);
      assert.equal(published.at(-1)?.contentType, normalized);
      assert.ok(published.at(-1)?.filename.endsWith(extension));
      assert.equal(options.at(-1)?.metadata?.contentType, normalized);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("simplified feed always returns empty JSON on parsing, database and mapping errors", async () => {
  let fail: "none" | "database" | "mapping" = "none";
  const failures: unknown[] = [];
  const app = express();
  const handler = createClipsFeedHandler({
    async loadRows() {
      if (fail === "database") throw new Error("Database unavailable");
      if (fail === "mapping") return [{ get id(): number { throw new Error("Malformed row"); } }];
      return [{ id: 42, title: "Clip", thumbnail_object_name: "private-thumb.jpg" }];
    },
    logFailure(error) { failures.push(error); },
  });
  app.get("/clips/feed", handler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/clips/feed`;
  try {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    const body = await response.json() as { clips: Record<string, unknown>[] };
    assert.equal(body.clips[0].video_url, "/api/clips/stream/42");
    assert.equal(body.clips[0].thumb, "/api/clips/thumbnail/42");
    assert.equal(body.clips[0].thumbnail_object_name, undefined);
    assert.deepEqual(await (await fetch(`${base}?limit=invalid`)).json(), { clips: [], hasMore: false });
    fail = "database";
    assert.deepEqual(await (await fetch(base)).json(), { clips: [], hasMore: false });
    fail = "mapping";
    assert.deepEqual(await (await fetch(base)).json(), { clips: [], hasMore: false });
    let fallback: unknown;
    await handler(
      { get query() { throw new Error("Query parsing failed"); } } as unknown as Request,
      { json(value: unknown) { fallback = value; } } as Response,
      () => { throw new Error("Unexpected next"); },
    );
    assert.deepEqual(fallback, { clips: [], hasMore: false });
    assert.equal(failures.length, 4);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});