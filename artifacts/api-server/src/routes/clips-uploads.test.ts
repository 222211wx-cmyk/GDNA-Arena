import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createClipsUploadsRouter } from "./clips-uploads.js";
import { fixture, metadata, metadataHeader } from "../lib/clip-uploads.test.js";

test("Tus HTTP protocol: auth first, ownership, bounds, HEAD, offsets, completion and cancellation", async () => {
  const { service, publisher } = fixture();
  const app = express();
  app.use((req, _res, next) => {
    if (req.header("X-Test-User")) (req as unknown as { session: { userId: number } }).session = { userId: Number(req.header("X-Test-User")) };
    next();
  });
  app.use("/api", createClipsUploadsRouter(service));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const root = "/api/clips/uploads";
  const headers = { "X-Test-User": "1", "Tus-Resumable": "1.0.0" };
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${base}${path}`, init);
    const text = await response.text();
    return { response, status: response.status, text };
  };
  try {
    for (const method of ["POST", "HEAD", "PATCH", "DELETE"]) {
      const result = await request(method === "POST" ? root : `${root}/unknown`, {
        method, headers: method === "PATCH" ? { "Content-Type": "application/offset+octet-stream" } : undefined,
        ...(method === "PATCH" ? { body: "unauthorized bytes" } : {}),
      });
      assert.equal(result.status, 401, `${method} must authenticate before version or body parsing`);
    }
    assert.equal((await request(`${root}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{invalid" })).status, 401);
    assert.equal((await request(root, { method: "POST", headers: { "X-Test-User": "1" } })).status, 412);
    const meta = metadata();
    const created = await request(root, {
      method: "POST", headers: { ...headers, "Upload-Length": "6", "Upload-Metadata": metadataHeader(meta as unknown as Record<string, unknown>) },
    });
    assert.equal(created.status, 201, created.text);
    const location = created.response.headers.get("Location")!;
    assert.match(location, /^\/api\/clips\/uploads\/[a-f0-9-]+$/);
    assert.equal(created.response.headers.get("Upload-Offset"), "0");
    assert.equal(created.response.headers.get("Tus-Resumable"), "1.0.0");
    const id = location.split("/").at(-1)!;
    for (const method of ["HEAD", "PATCH", "DELETE"]) {
      const result = await request(location, {
        method, headers: { ...headers, "X-Test-User": "2", "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream" },
        ...(method === "PATCH" ? { body: "abc" } : {}),
      });
      assert.equal(result.status, 404);
    }
    assert.equal((await request(`${root}/complete`, {
      method: "POST", headers: { ...headers, "X-Test-User": "2", "Content-Type": "application/json" }, body: JSON.stringify({ uploadIds: [id] }),
    })).status, 404);
    const patchHeaders = { ...headers, "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream" };
    assert.equal((await request(location, { method: "PATCH", headers: { ...patchHeaders, "Content-Type": "text/plain" }, body: "abc" })).status, 415);
    assert.equal((await request(location, { method: "PATCH", headers: patchHeaders, body: "abcdefg" })).status, 413);
    assert.equal((await request(location, { method: "PATCH", headers: patchHeaders, body: "abc" })).status, 204);
    assert.equal((await request(location, { method: "PATCH", headers: patchHeaders, body: "abc" })).status, 409);
    const head = await request(location, { method: "HEAD", headers });
    assert.equal(head.status, 200);
    assert.equal(head.response.headers.get("Upload-Offset"), "3");
    assert.equal(head.response.headers.get("Upload-Length"), "6");
    assert.equal(head.response.headers.get("Cache-Control"), "no-store");
    assert.equal((await request(location, { method: "PATCH", headers: { ...patchHeaders, "Upload-Offset": "3" }, body: "def" })).status, 204);
    const completion = { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ uploadIds: [id] }) };
    const done = await request(`${root}/complete`, completion);
    assert.equal(done.status, 200, done.text);
    assert.equal(JSON.parse(done.text).clip.id, 1);
    assert.equal((await request(`${root}/complete`, completion)).text, done.text);
    assert.equal(publisher.publishedInputs.length, 1);
    assert.equal((await request(location, { method: "DELETE", headers })).status, 409);
    const cancelled = await request(root, {
      method: "POST", headers: { ...headers, "Upload-Length": "6", "Upload-Metadata": metadataHeader(metadata() as unknown as Record<string, unknown>) },
    });
    const cancelLocation = cancelled.response.headers.get("Location")!;
    assert.equal((await request(cancelLocation, { method: "DELETE", headers })).status, 204);
    assert.equal((await request(cancelLocation, { method: "HEAD", headers })).status, 410);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});