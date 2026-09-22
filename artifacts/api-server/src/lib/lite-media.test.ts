import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import pg from "pg";
import { pool as appPool } from "@workspace/db";
import { generateLiteAudio, PermanentAudioError } from "./lite-audio";
import { mediaHash, readVerifiedMedia, storeVerifiedMedia, type MediaResolver } from "./lite-media-storage";
import { runLiteMediaBatch } from "../jobs/lite-media";
import { enqueueLiteMediaDeletion } from "./lite-media-cleanup";
import { liteMediaMetadata } from "./lite-media-policy";
import { senderExpectationMatches } from "./message-idempotency";
import { expectedSenderGuard } from "./message-sender-guard";
import express from "express";

after(() => appPool.end());
function fixture(video = true, duration = 2) {
  const result = spawnSync("ffmpeg", ["-v", "error",
    ...(video ? ["-f", "lavfi", "-i", "color=c=blue:s=32x32:r=10"] : []),
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${duration}`,
    "-t", String(duration), ...(video ? ["-c:v", "mpeg4"] : []),
    "-c:a", "aac", "-b:a", "64k", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"],
    { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

test("actual AAC derivative has only audio, actual size/duration and temp cleanup; small audio reuses bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "lite-audio-test-"));
  try {
    const result = await generateLiteAudio(Readable.from([fixture()]), undefined, root);
    assert.equal(result.mime, "audio/mp4");
    assert.equal(result.reused, false);
    assert.ok(result.durationSec >= 1.9 && result.durationSec <= 3);
    assert.ok(result.bytes.length > 0 && result.bytes.length < 20000);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", "pipe:0"], { input: result.bytes });
    assert.deepEqual(JSON.parse(probe.stdout.toString()).streams, [{ codec_name: "aac", codec_type: "audio" }]);
    const sourceAudio = fixture(false);
    const reused = await generateLiteAudio(Readable.from([sourceAudio]), undefined, root);
    assert.equal(reused.reused, true);
    assert.deepEqual(reused.bytes, sourceAudio);
    await assert.rejects(generateLiteAudio(Readable.from([Buffer.from("invalid media")]), undefined, root));
    const noAudio = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=s=16x16", "-t", "1",
      "-c:v", "mpeg4", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"]).stdout;
    await assert.rejects(generateLiteAudio(Readable.from([noAudio]), undefined, root), PermanentAudioError);
    await assert.rejects(generateLiteAudio(Readable.from([fixture(false, 601)]), undefined, root), PermanentAudioError);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function storage() {
  const objects = new Map<string, Buffer>();
  const failures = new Set<string>();
  let mirrorWriteFails = false;
  const file: MediaResolver = name => ({
    createReadStream() {
      if (failures.has(name) || !objects.has(name)) return Readable.from((async function* () { throw new Error("Injected provider outage"); })());
      return Readable.from([objects.get(name)!]);
    },
    createWriteStream() {
      const chunks: Buffer[] = [];
      return new Writable({
        write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
        final(done) {
          if (mirrorWriteFails && !name.startsWith("r2:")) { done(new Error("Injected App Storage outage")); return; }
          objects.set(name, Buffer.concat(chunks)); done();
        },
      });
    },
  } as ReturnType<MediaResolver>);
  return { objects, failures, file, failMirrorWrite() { mirrorWriteFails = true; } };
}

test("verified App Storage fallback serves identical bytes only; wrong/unverified copies fail closed", async () => {
  const s = storage();
  const bytes = Buffer.from("same immutable derivative bytes");
  const primary = "r2:clips/derived/audio-test", mirror = "audio-test-mirror";
  const meta = await storeVerifiedMedia(bytes, "audio/mp4", primary, mirror, undefined, s.file);
  const row = { output_object: primary, mirror_object: mirror, mirror_verified_at: new Date(),
    size_bytes: meta.sizeBytes, sha256: meta.sha256 };
  s.failures.add(primary);
  assert.deepEqual(await readVerifiedMedia(row, s.file), bytes);
  await assert.rejects(readVerifiedMedia({ ...row, mirror_verified_at: null }, s.file));
  s.objects.set(mirror, Buffer.from("another object's bytes"));
  await assert.rejects(readVerifiedMedia(row, s.file));
  s.failures.add(mirror);
  await assert.rejects(readVerifiedMedia(row, s.file));
  assert.equal(meta.sha256, mediaHash(bytes));
  assert.equal(liteMediaMetadata({ state: "ready", size_bytes: 1048577 }, 1).requiresConsent, true);
});

test("durable worker reserves both outputs, creates real audio/poster, retries failures, and deletion queues both providers", async () => {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `lite_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const database = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
  const s = storage();
  try {
    await database.query(`CREATE TABLE clips(id integer PRIMARY KEY,object_name text,thumbnail_object_name text,is_frozen boolean DEFAULT false);
      CREATE TABLE clip_storage_cleanup(object_name text PRIMARY KEY,clip_id integer,retry_at timestamptz DEFAULT now());`);
    await database.query(await readFile("../../lib/db/drizzle/lite-media.sql", "utf8"));
    const source = "r2:clips/original/test-video";
    s.objects.set(source, fixture());
    const poster = "r2:clips/derived/test-poster";
    const png = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=48x48",
      "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"]).stdout;
    s.objects.set(poster, png);
    await database.query("INSERT INTO clips(id,object_name,thumbnail_object_name) VALUES(1,$1,$2),(2,$1,$2),(3,$1,$2)", [source, poster]);
    await database.query(`INSERT INTO clip_lite_media(clip_id,kind,output_object,mirror_object)
      VALUES(1,'audio','r2:clips/derived/crashed','crashed-mirror'),(1,'poster',NULL,NULL)`);
    const deps = { pool: database, file: s.file };
    assert.equal(await runLiteMediaBatch(undefined, deps), 1);
    assert.equal(await runLiteMediaBatch(undefined, deps), 1);
    const rows = (await database.query("SELECT * FROM clip_lite_media WHERE clip_id=1 ORDER BY kind")).rows;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.state, "ready");
      assert.ok(row.mirror_verified_at);
      assert.equal(row.size_bytes, s.objects.get(row.output_object)!.length);
      s.failures.add(row.output_object);
      assert.deepEqual(await readVerifiedMedia(row, s.file), s.objects.get(row.mirror_object));
    }
    const posterRow = rows.find(row => row.kind === "poster")!;
    assert.equal(posterRow.mime, "image/webp");
    assert.ok(posterRow.size_bytes <= 10240);
    const queuedOld = (await database.query("SELECT object_name FROM clip_storage_cleanup")).rows.map(r => r.object_name);
    assert.deepEqual(queuedOld.sort(), ["crashed-mirror", "r2:clips/derived/crashed"]);
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await enqueueLiteMediaDeletion(client, 1);
      await client.query("DELETE FROM clips WHERE id=1");
      await client.query("COMMIT");
    } finally { client.release(); }
    assert.equal((await database.query("SELECT * FROM clip_lite_media WHERE clip_id=1")).rowCount, 0);
    const cleanup = (await database.query("SELECT object_name FROM clip_storage_cleanup")).rows.map(r => r.object_name);
    for (const row of rows) { assert.ok(cleanup.includes(row.output_object)); assert.ok(cleanup.includes(row.mirror_object)); }
    assert.ok(!cleanup.includes(source) && !cleanup.includes(poster), "Derivative cleanup never deletes original source");
    s.failMirrorWrite();
    await database.query("INSERT INTO clip_lite_media(clip_id,kind) VALUES(2,'audio')");
    assert.equal(await runLiteMediaBatch(undefined, deps), 0);
    const failed = (await database.query("SELECT * FROM clip_lite_media WHERE clip_id=2")).rows[0];
    assert.equal(failed.state, "queued");
    assert.equal(failed.attempts, 1);
    assert.equal(failed.output_object, null);
    assert.ok(new Date(failed.retry_at).getTime() > Date.now());
    assert.equal((await database.query("SELECT * FROM clip_storage_cleanup WHERE clip_id=2")).rowCount, 2);
    await database.query(`INSERT INTO clip_lite_media(clip_id,kind,state,attempts,retry_at,output_object,mirror_object)
      VALUES(3,'audio','processing',4,now()-interval '1 hour','r2:clips/derived/exhausted','exhausted-mirror')`);
    await runLiteMediaBatch(undefined, deps);
    assert.equal((await database.query("SELECT state FROM clip_lite_media WHERE clip_id=3")).rows[0].state, "failed");
    assert.equal((await database.query("SELECT * FROM clip_storage_cleanup WHERE clip_id=3")).rowCount, 2);
  } finally {
    await database.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

test("queued sender expectation rejects switched session before any reservation/message call", () => {
  let reservations = 0, messages = 0;
  const send = (expected: unknown, session: number) => {
    if (!senderExpectationMatches(expected, session)) return 409;
    reservations++; messages++; return 201;
  };
  for (const expected of [1, "2", null, 2.5, NaN]) assert.equal(send(expected, 2), 409);
  assert.equal(reservations, 0);
  assert.equal(messages, 0);
  assert.equal(send(2, 2), 201);
  assert.ok(senderExpectationMatches(undefined, 2), "legacy clients remain supported");
});

test("actual sender guard returns HTTP 409 and creates zero database messages/receipts after account switch", async () => {
  const database = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await database.connect();
  await client.query("BEGIN");
  await client.query("CREATE TEMP TABLE guard_test_messages(id int); CREATE TEMP TABLE guard_test_receipts(id int)");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: 22 } as typeof req.session; next();
  });
  app.post("/send", expectedSenderGuard, async (_req, res) => {
    await client.query("INSERT INTO guard_test_messages VALUES(1); INSERT INTO guard_test_receipts VALUES(1)");
    res.status(201).end();
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/send`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedSenderId: 11, clientMessageId: randomUUID(), content: "queued ciphertext" }) });
    assert.equal(response.status, 409);
    assert.equal((await client.query("SELECT * FROM guard_test_messages")).rowCount, 0);
    assert.equal((await client.query("SELECT * FROM guard_test_receipts")).rowCount, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await client.query("ROLLBACK");
    client.release();
    await database.end();
  }
});