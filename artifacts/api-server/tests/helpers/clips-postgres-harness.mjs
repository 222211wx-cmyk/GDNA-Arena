import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";
import pg from "pg";

const apiRoot = fileURLToPath(new URL("../../", import.meta.url));

export function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

export async function eventually(check, message) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

/**
 * Only external media/storage and logging are doubles. The injected pool is a
 * real pg.Pool: all worker/route SQL and transactions run unchanged in Postgres.
 * Two independent bundles give replicas separate module-level `running` flags.
 */
export async function clipsFixture(t, database) {
  const schema = `clip_retry_${randomUUID().replaceAll("-", "")}`;
  const temp = await mkdtemp(path.join(os.tmpdir(), "clip-sql-"));
  const pools = [];
  const servers = [];
  const globals = [];
  const gates = [];
  const work = [];
  let replicaNumber = 0;
  let schemaCreated = false;
  const state = {
    objects: new Map(), writes: [], deletes: [], deleteCalls: [], generations: [], warnings: [],
    generate: async () => Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]),
    beforeWrite: async () => {},
    beforeDelete: async () => {},
    afterDelete: async () => {},
  };
  t.after(async () => {
    for (const barrier of gates) barrier.release();
    await Promise.allSettled(work);
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await Promise.all(pools.map(pool => pool.end()));
    for (const key of globals) delete globalThis[key];
    if (schemaCreated) await database.admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await rm(temp, { recursive: true, force: true });
  });
  await database.admin.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  function pool(label) {
    const value = new pg.Pool({
      ...database.config, max: 4,
      application_name: `${schema}_${label}`,
      // Deliberately exclude public: absent fixtures must fail, never fall back.
      options: `-c search_path=${schema} -c statement_timeout=5000 -c lock_timeout=4000`,
    });
    pools.push(value);
    return value;
  }
  const observer = pool("observer");
  await observer.query(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, is_admin BOOLEAN NOT NULL DEFAULT FALSE);
    CREATE TABLE monetization_settings (content_type TEXT PRIMARY KEY, rate NUMERIC, unit TEXT);
    CREATE TABLE content_fingerprints (
      fingerprint TEXT PRIMARY KEY, content_type TEXT NOT NULL,
      content_id INTEGER NOT NULL, owner_name TEXT NOT NULL
    );
    INSERT INTO users (id, is_admin) VALUES (7, FALSE), (8, FALSE), (9, TRUE);
  `);
  function file(name) {
    const key = name.split("/clips/").at(-1);
    return {
      name,
      createReadStream(range) {
        assert.ok(state.objects.has(key), `missing test object: ${key}`);
        const bytes = state.objects.get(key);
        return Readable.from([range ? bytes.subarray(range.start, range.end + 1) : bytes]);
      },
      async getMetadata() { return [{ size: state.objects.get(key)?.length ?? 0 }]; },
      createWriteStream() {
        const chunks = [];
        return new Writable({
          write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
          final(done) {
            Promise.resolve(state.beforeWrite(key)).then(() => {
              state.objects.set(key, Buffer.concat(chunks));
              state.writes.push(key);
              done();
            }, done);
          },
        });
      },
      async delete(options) {
        state.deleteCalls.push({ key, options });
        await state.beforeDelete(key, options);
        state.deletes.push(key);
        state.objects.delete(key);
        await state.afterDelete(key, options);
      },
    };
  }
  async function replica(label) {
    const instance = replicaNumber++;
    const realPool = pool(label);
    const key = `clipHarness_${randomUUID().replaceAll("-", "")}`;
    globals.push(key);
    globalThis[key] = {
      pool: realPool,
      objectStorageClient: { bucket: () => ({ file }) },
      logger: {
        info() {}, error(...args) { state.warnings.push(args); },
        warn(...args) { state.warnings.push(args); },
      },
      async generateClipThumbnail(original) {
        state.generations.push(original.name);
        return state.generate(original);
      },
    };
    const boundary = path.join(temp, `${label}-${instance}-boundary.mjs`);
    const entry = path.join(temp, `${label}-${instance}-entry.mjs`);
    const output = path.join(temp, `${label}-${instance}.cjs`);
    await writeFile(boundary, `
      const host = globalThis[${JSON.stringify(key)}];
      export const { pool, objectStorageClient, logger, generateClipThumbnail } = host;
    `);
    await writeFile(entry, `
      import express from "express";
      import router, { ensureClipsTables } from ${JSON.stringify(path.join(apiRoot, "src/routes/clips.ts"))};
      export { runClipThumbnailRetryBatch } from ${JSON.stringify(path.join(apiRoot, "src/jobs/clip-thumbnail-retry.ts"))};
      export { runClipStorageCleanupBatch } from ${JSON.stringify(path.join(apiRoot, "src/jobs/clip-storage-cleanup.ts"))};
      export { retryThumbnailName } from ${JSON.stringify(path.join(apiRoot, "src/lib/clip-storage.ts"))};
      export { ensureClipsTables };
      const app = express();
      app.use((req, _res, next) => {
        req.session = { userId: Number(req.headers["x-test-user"]) || undefined };
        next();
      });
      app.use(express.json());
      app.use(router);
      export { app };
    `);
    await build({
      entryPoints: [entry], outfile: output, platform: "node", format: "cjs",
      bundle: true, logLevel: "silent",
      nodePaths: [path.join(apiRoot, "node_modules")],
      plugins: [{
        name: "real-postgres-external-media-only",
        setup(plugin) {
          plugin.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: boundary }));
          plugin.onResolve({ filter: /(?:^|\/)chatStorage(?:\.js)?$/ }, () => ({ path: boundary }));
          plugin.onResolve({ filter: /\/(?:lib\/)?logger(?:\.js)?$/ }, () => ({ path: boundary }));
          plugin.onResolve({ filter: /\/clip-thumbnail\.js$/ }, () => ({ path: boundary }));
        },
      }],
    });
    const module = (await import(pathToFileURL(output).href)).default;
    return { ...module, pool: realPool, label: `${schema}_${label}` };
  }
  const a = await replica("a");
  const b = await replica("b");
  // Production DDL, in the private search_path only.
  await a.ensureClipsTables();
  assert.equal((await observer.query("SELECT count(*) FROM clips")).rows[0].count, "0");
  async function seed(id, options = {}) {
    const objectName = `original_${id}.mp4`;
    const thumbnailObjectName = options.thumbnailObjectName ?? null;
    await observer.query(`
      INSERT INTO clips
        (id,user_id,username,title,object_name,thumbnail_object_name,content_type,duration_sec,thumbnail_retry_at)
      VALUES ($1,7,'fixture-owner','Test clip',$2,$3,'video/mp4',61,NOW() - INTERVAL '1 hour')
    `, [id, objectName, thumbnailObjectName]);
    await observer.query(`
      INSERT INTO content_fingerprints VALUES ($1,'clip',$2,'fixture-owner');
    `, [`fingerprint-${id}`, id]);
    state.objects.set(objectName, Buffer.from(`original-${id}`));
    if (thumbnailObjectName) state.objects.set(thumbnailObjectName, Buffer.from(`poster-${id}`));
    return {
      id, objectName, thumbnailObjectName,
      posterName: a.retryThumbnailName(id, objectName),
    };
  }
  return {
    a, b, observer, state, seed, schema,
    freshReplica(label = `fresh-${replicaNumber}`) { return replica(label); },
    track(promise) { work.push(promise); return promise; },
    gate() { const barrier = gate(); gates.push(barrier); return barrier; },
    async http(replica = a) {
      const server = await new Promise(resolve => {
        const instance = replica.app.listen(0, "127.0.0.1", () => resolve(instance));
      });
      servers.push(server);
      return `http://127.0.0.1:${server.address().port}`;
    },
  };
}