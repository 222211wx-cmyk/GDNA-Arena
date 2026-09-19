import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const race of [false, true]) {
  test(`queue reserves provider-safe 720p output and ${race ? "losing CAS cleans only candidate" : "successful CAS retains original"}`, async t => {
    const temp = await mkdtemp(path.join(tmpdir(), "clip-queue-"));
    t.after(() => rm(temp, { recursive: true, force: true }));
    const key = `queue_${randomUUID().replaceAll("-", "")}`;
    t.after(() => { delete globalThis[key]; });
    const candidate = {
      id: 123, object_name: "r2:clips/original/7/owned.mp4",
      content_type: "video/mp4", size_bytes: "144011428",
      processing_attempts: 0, processing_output_object: null,
    };
    const cleanups = [];
    let reserved, published;
    const client = {
      on() {}, off() {}, release() {},
      async query(sql, params = []) {
        if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
        if (sql.includes("pg_advisory_unlock") || sql.includes("WITH exhausted") ||
            ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
        if (sql.includes("SELECT id, object_name, content_type")) return { rows: [{ ...candidate }] };
        if (sql.includes("SET processing_status='processing'")) {
          reserved = params[2];
          return { rows: [] };
        }
        if (sql.includes("SELECT id, thumbnail_object_name")) {
          assert.equal(params[1], candidate.object_name);
          assert.equal(params[2], 1);
          assert.equal(params[3], reserved);
          return { rows: race ? [] : [{ id: candidate.id, thumbnail_object_name: null }] };
        }
        if (sql.includes("SET object_name=$2")) {
          published = params[1];
          assert.equal(params[2], "video/mp4");
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO clip_storage_cleanup")) {
          cleanups.push(...params[1]);
          return { rows: [] };
        }
        throw new Error(`Unexpected SQL ${sql}`);
      },
    };
    globalThis[key] = {
      pool: { connect: async () => client },
      compressStoredClip: async input => {
        assert.equal(input.filename, candidate.object_name);
        assert.equal(input.force, true);
        assert.equal(input.outputFilename, reserved);
        assert.match(reserved, /^r2:clips\/derived\/clip_compressed_[a-f0-9]{32}_720p\.mp4$/);
        assert.equal(input.signal.aborted, false);
        return { filename: reserved, contentType: "video/mp4", size: 1000 };
      },
    };
    const boundary = path.join(temp, "boundary.mjs");
    await writeFile(boundary, `
      const host = globalThis[${JSON.stringify(key)}];
      export const pool = host.pool;
      export const compressStoredClip = host.compressStoredClip;
      export class ClipCompressionCleanupError extends Error {}
      export const providerSibling = (source, name) => "r2:clips/derived/" + name;
      export const logger = { warn() {}, error() {} };
    `);
    const output = path.join(temp, "queue.cjs");
    await build({
      entryPoints: [path.join(root, "src/jobs/clip-compression.ts")], outfile: output,
      bundle: true, platform: "node", format: "cjs", logLevel: "silent",
      plugins: [{ name: "queue-boundaries", setup(plugin) {
        plugin.onResolve({ filter: /^@workspace\/db$|\/(?:clip-server-compression|clip-storage|logger)\.js$/ },
          () => ({ path: boundary }));
      } }],
    });
    const { runClipCompressionBatch } = (await import(pathToFileURL(output).href)).default;
    assert.equal(await runClipCompressionBatch(), race ? 0 : 1);
    assert.ok(!cleanups.includes(candidate.object_name), "original never scheduled for cleanup");
    if (race) {
      assert.equal(published, undefined);
      assert.deepEqual(cleanups, [reserved]);
    } else assert.equal(published, reserved);
  });
}