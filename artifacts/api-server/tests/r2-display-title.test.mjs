import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const apiRoot = fileURLToPath(new URL("../", import.meta.url));

test("R2 initiate persists display title and includes it in retry identity", async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "r2-title-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const key = `r2Title_${randomUUID().replaceAll("-", "")}`;
  t.after(() => { delete globalThis[key]; });

  const sessions = new Map();
  let creates = 0;
  globalThis[key] = {
    pool: {
      async query(sql, params) {
        if (sql.includes("FROM r2_clip_uploads WHERE user_id=$1 AND request_id=$2")) {
          return { rows: sessions.has(params[1]) ? [sessions.get(params[1])] : [] };
        }
        if (sql.includes("INSERT INTO r2_clip_uploads")) {
          const [id, userId, requestId, objectName, multipartUploadId, originalName,
            displayTitle, contentType, sizeBytes, durationSec] = params;
          sessions.set(requestId, {
            id, user_id: userId, object_name: objectName, multipart_upload_id: multipartUploadId,
            original_name: originalName, display_title: displayTitle, content_type: contentType,
            size_bytes: String(sizeBytes), duration_sec: durationSec, state: "active",
            clip_id: null, expires_at: new Date(Date.now() + 60_000),
          });
          return { rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
    client: {
      async send() {
        creates++;
        return { UploadId: `upload-${creates}` };
      },
    },
  };

  const boundary = path.join(temp, "boundary.mjs");
  const entry = path.join(temp, "entry.mjs");
  const output = path.join(temp, "bundle.cjs");
  await writeFile(boundary, `
    const host = globalThis[${JSON.stringify(key)}];
    export const pool = host.pool;
    export const r2Client = () => host.client;
    export const r2Config = () => ({ bucket: "test" });
    export const r2ConnectionStatus = async () => ({ ok: true });
    export const r2Reference = value => "r2:" + value;
    export const logger = { warn() {}, info() {}, error() {} };
    export const clipFile = () => ({ getMetadata: async () => [{ size: 1 }] });
    export const verifiedDuration = async () => 60;
    export class ClipProbeBusyError extends Error {}
  `);
  await writeFile(entry, `
    import express from "express";
    import router from ${JSON.stringify(path.join(apiRoot, "src/routes/r2.ts"))};
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.session = { userId: 7 }; next(); });
    app.use(router);
    export { app };
  `);
  await build({
    entryPoints: [entry], outfile: output, platform: "node", format: "cjs",
    bundle: true, logLevel: "silent", nodePaths: [path.join(apiRoot, "node_modules")],
    plugins: [{
      name: "r2-title-boundaries",
      setup(plugin) {
        plugin.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: boundary }));
        plugin.onResolve({ filter: /\/r2-storage\.js$/ }, () => ({ path: boundary }));
        plugin.onResolve({ filter: /\/logger\.js$/ }, () => ({ path: boundary }));
        plugin.onResolve({ filter: /\/clip-storage\.js$/ }, () => ({ path: boundary }));
        plugin.onResolve({ filter: /\/clip-duration\.js$/ }, () => ({ path: boundary }));
      },
    }],
  });
  const { app } = (await import(pathToFileURL(output).href)).default;
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const requestId = randomUUID();
  const initiate = title => fetch(`${base}/r2/presign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "initiate", requestId, filename: "original.movie.mp4",
      title, contentType: "video/mp4", size: 10, durationSec: 61,
    }),
  });

  const first = await initiate("  اسم/نسخة.v1  ");
  assert.equal(first.status, 201, await first.text());
  assert.equal(sessions.get(requestId).original_name, "original.movie.mp4");
  assert.equal(sessions.get(requestId).display_title, "اسم/نسخة.v1");
  assert.equal((await initiate("اسم/نسخة.v1")).status, 200);
  assert.equal((await initiate("اسم آخر")).status, 409);
  assert.equal(creates, 1);

  for (const invalid of ["   ", "ع".repeat(121), 42]) {
    const response = await fetch(`${base}/r2/presign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "initiate", requestId: randomUUID(), filename: "original.movie.mp4",
        title: invalid, contentType: "video/mp4", size: 10, durationSec: 61,
      }),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(creates, 1);
});