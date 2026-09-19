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
  const clips = new Map();
  const jobs = new Map();
  let creates = 0;
  let storageCalls = 0;
  const databaseClient = {
    async query(sql, params = []) {
      if (sql.includes("INSERT INTO clip_media_jobs")) {
        if (!jobs.has(params[0])) jobs.set(params[0],{state:"queued"});
        return {rows:[]};
      }
      if (sql.includes("SET state='completing'")) {
        [...sessions.values()].find(row=>row.id===params[0]).state="completing";
        return {rows:[]};
      }
      if (sql.includes("pg_advisory_")) return { rows: [] };
      if (sql.includes("FROM r2_clip_uploads WHERE id=$1 AND user_id=$2")) {
        const row = [...sessions.values()].find(value => value.id === params[0] && value.user_id === params[1]);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("FROM clips WHERE user_id=$1")) {
        const clip = [...clips.values()].find(value =>
          value.user_id === params[0] && value.object_name === params[1]);
        return { rows: clip ? [clip] : [] };
      }
      if (sql.includes("SELECT * FROM clips WHERE id=$1 AND user_id=$2")) {
        const clip = clips.get(params[0]);
        return { rows: clip?.user_id === params[1] ? [clip] : [] };
      }
      if (sql.includes("SELECT username FROM users")) return { rows: [{ username: "owner" }] };
      if (sql.includes("INSERT INTO clips")) {
        const clip = {
          id: 91, user_id: params[0], title: params[2], object_name: params[3],
          content_type: params[4], duration_sec: params[6], code: params[7],
          processing_status: params[8], created_at: new Date().toISOString(),
          thumbnail_object_name: null,
        };
        clips.set(clip.id, clip);
        return { rows: [clip] };
      }
      if (sql.includes("UPDATE r2_clip_uploads SET state='published'")) {
        const row = [...sessions.values()].find(value => value.id === params[0] && value.user_id === params[2]);
        if (row) { row.state = "published"; row.clip_id = params[1]; }
        return { rows: [] };
      }
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" ||
          sql.includes("SET state='completing'")) return { rows: [] };
      throw new Error(`Unexpected client SQL: ${sql}`);
    },
    release() {},
  };
  globalThis[key] = {
    pool: {
      async query(sql, params) {
        if (sql.includes("FROM clip_media_jobs")) {
          const owner = [...sessions.values()].find(row=>row.id===params[0] && row.user_id===params[1]);
          return {rows:owner && jobs.has(params[0]) ? [jobs.get(params[0])] : []};
        }
        if (sql.includes("FROM r2_clip_uploads WHERE id=$1 AND user_id=$2")) {
          const row = [...sessions.values()].find(value => value.id === params[0] && value.user_id === params[1]);
          return { rows: row ? [row] : [] };
        }
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
      async connect() { return databaseClient; },
    },
    client: {
      async send(command) {
        storageCalls++;
        if (!command.input.UploadId) {
          if (!command.input.Metadata) {
            return {
              ContentLength: 10, ContentType: "video/mp4",
              Metadata: { owner: "7", session: [...sessions.values()][0].id },
            };
          }
          creates++;
          return { UploadId: `upload-${creates}` };
        }
        if (command.input.MultipartUpload) return {};
        const ownerSession=[...sessions.values()].find(row=>row.object_name===`r2:${command.input.Key}`);
        if (Number(ownerSession?.size_bytes)===10737418240) {
          const start=Number(command.input.PartNumberMarker ?? 0);
          const count=Math.min(1000,2048-start);
          return {Parts:Array.from({length:count},(_,i)=>({PartNumber:start+i+1,ETag:`"${"a".repeat(32)}"`,Size:5242880})),
            IsTruncated:start+count<2048,NextPartNumberMarker:String(start+count)};
        }
        return { Parts: [{ PartNumber: 1, ETag: `"${"a".repeat(32)}"`, Size: 10 }], IsTruncated: false };
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
    export const clipFile = () => ({ getMetadata: async () => [{ size: 10 }] });
    export const verifiedDuration = async () => { throw Error("API MUST NOT PROBE"); };
    export class ClipProbeBusyError extends Error {}
    class Command { constructor(input) { this.input = input; } }
    export class AbortMultipartUploadCommand extends Command {}
    export class CompleteMultipartUploadCommand extends Command {}
    export class CreateMultipartUploadCommand extends Command {}
    export class HeadObjectCommand extends Command {}
    export class ListPartsCommand extends Command {}
    export class UploadPartCommand extends Command {}
    export const getSignedUrl = async () => "https://r2.invalid/signed";
  `);
  await writeFile(entry, `
    import express from "express";
    import router from ${JSON.stringify(path.join(apiRoot, "src/routes/r2.ts"))};
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { userId: Number(req.header("x-test-user") || 7) };
      next();
    });
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
         plugin.onResolve({ filter: /^@aws-sdk\/client-s3$/ }, () => ({ path: boundary }));
         plugin.onResolve({ filter: /^@aws-sdk\/s3-request-presigner$/ }, () => ({ path: boundary }));
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

  const session = sessions.get(requestId);
  const finalize = (userId, body) => fetch(`${base}/clips/create`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": String(userId) },
    body: JSON.stringify(body),
  });
  const completion = {
    sessionId: session.id,
    title: "اسم/نسخة.v1",
    parts: [{ partNumber: 1, etag: `"${"a".repeat(32)}"` }],
  };
  for (const action of ["inspect", "part", "abort", "complete"]) {
    const foreign = await fetch(`${base}/r2/presign`, {
      method: "POST", headers: { "content-type": "application/json", "x-test-user": "8" },
      body: JSON.stringify({ action, sessionId: session.id, partNumber: 1 }),
    });
    assert.equal(foreign.status, 404, `${action} rejects foreign session`);
  }
  const switched = await finalize(7, { ...completion, expectedOwnerId: 8 });
  assert.equal(switched.status, 403, "account-switch expectation is enforced");
  const inspect = () => fetch(`${base}/r2/presign`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "inspect", sessionId: session.id }),
  });
  assert.deepEqual((await (await inspect()).json()).parts,
    [{ partNumber: 1, etag: `"${"a".repeat(32)}"`, size: 10 }],
    "fresh client reconstructs authoritative stored parts without a local offset");
  assert.equal((await inspect()).headers.get("cache-control"), "no-store");
  const beforeOwnershipCheck = storageCalls;
  assert.equal((await finalize(8, completion)).status, 404,
    "another citizen cannot finalize an upload session they do not own");
  assert.equal(storageCalls, beforeOwnershipCheck,
    "ownership is checked before any R2 completion request");
  for (const etag of [`"${"a".repeat(32)}`, `${"a".repeat(32)}"`, `"${"z".repeat(32)}"`, ""]) {
    assert.equal((await finalize(7, {
      ...completion, parts: [{ partNumber: 1, etag }],
    })).status, 400, "malformed or one-sided quoted ETags are rejected");
  }
  assert.equal((await finalize(7, {
    ...completion, parts: [{ partNumber: 1, etag: `"${"b".repeat(32)}"` }],
  })).status, 409, "valid but incorrect ETag cannot authorize completion");
  assert.equal((await finalize(7, { ...completion, url: "https://public.invalid/foreign.mp4" })).status, 400,
    "client object URLs are never trusted");
  const completed = await finalize(7, completion);
  const completedText = await completed.text();
  assert.equal(completed.status, 202, completedText);
  const receipt = JSON.parse(completedText);
  assert.equal(receipt.state, "queued");
  assert.equal(receipt.receipt, undefined);
  assert.equal(session.state, "completing");
  assert.equal(clips.size,0,"API never inserts an unverified visible clip");
  const ownStatus = await fetch(`${base}/upload/status/${session.id}`);
  assert.equal(ownStatus.status,200);
  assert.equal((await ownStatus.json()).state,"queued");
  assert.equal((await fetch(`${base}/upload/status/${session.id}`,{headers:{"x-test-user":"8"}})).status,404);
  assert.equal((await fetch(`${base}/upload/status/${session.id}`,{headers:{"x-test-user":"0"}})).status,401);
  const legacy = await fetch(`${base}/r2/presign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "complete", ...completion }),
  });
  const legacyText = await legacy.text();
  assert.equal(legacy.status, 202, legacyText);
  assert.equal(JSON.parse(legacyText).sessionId, session.id,
    "legacy complete shares the idempotent finalization handler");
  const beforePublishedAbort = storageCalls;
  const aborted = await fetch(`${base}/r2/presign`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "abort", sessionId: session.id }),
  });
  assert.equal(aborted.status, 409, "abort after completion loses to the published state");
  assert.equal(storageCalls, beforePublishedAbort, "published media is never remotely aborted");
  assert.equal(jobs.size,1,"duplicate completion enqueues exactly once");
  session.state = "active";
  jobs.clear();
  session.expires_at = new Date(0);
  assert.equal((await initiate("اسم/نسخة.v1")).status, 410,
    "an expired retry identity must not pretend to be resumable");
  assert.equal((await inspect()).status, 410);
  for (const size of [10737418240,10737418241]) {
    const response=await fetch(`${base}/upload/presign`,{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({action:"initiate",expectedOwnerId:7,requestId:randomUUID(),
        filename:"large.mp4",contentType:"video/mp4",size,durationSec:null})
    });
    assert.equal(response.status,size===10737418240?201:413);
    if(response.status===201){
      const large=await response.json();
      assert.equal(large.partCount,2048);
      const inspectLarge=await fetch(`${base}/upload/presign`,{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"inspect",sessionId:large.sessionId})});
      assert.equal((await inspectLarge.json()).parts.length,2048,"inspection paginates all 2048 parts");
    }
  }
});