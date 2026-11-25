// Assault 3: connectors (R2 + GitHub in one click), /api/v1/upload (API key + signed webhook), failover, stats.
import http from "node:http";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import express from "express";
import { objects, startS3 } from "./s3-mock.js";

const s3 = await startS3();
const listen = (h: http.RequestListener) => new Promise<http.Server>((r) => { const s = http.createServer(h); s.listen(0, "127.0.0.1", () => r(s)); });
const port = (s: http.Server) => (s.address() as any).port;
const readBody = async (req: http.IncomingMessage) => { const c: Buffer[] = []; for await (const x of req) c.push(x as Buffer); return Buffer.concat(c); };

// mock GitHub
const ghWrites: { path: string; content: Buffer; auth: string }[] = [];
const gh = await listen(async (req, res) => {
  const body = await readBody(req); const u = req.url!.split("?")[0];
  if (req.method === "GET" && u.includes("/contents/")) { res.writeHead(404); return res.end("{}"); }
  if (req.method === "PUT" && u.includes("/contents/")) { ghWrites.push({ path: u, content: Buffer.from(JSON.parse(body.toString()).content, "base64"), auth: String(req.headers.authorization) }); res.writeHead(201, { "content-type": "application/json" }); return res.end(JSON.stringify({ content: { html_url: "https://github.test/f" } })); }
  if (req.method === "GET" && u.includes("/releases/tags/")) { res.writeHead(404); return res.end("{}"); }
  if (req.method === "POST" && u.endsWith("/releases")) { res.writeHead(201, { "content-type": "application/json" }); return res.end(JSON.stringify({ id: 42 })); }
  if (req.method === "POST" && u.includes("/releases/42/assets")) { ghWrites.push({ path: u, content: body, auth: "" }); res.writeHead(201, { "content-type": "application/json" }); return res.end(JSON.stringify({ browser_download_url: "https://github.test/asset" })); }
  res.writeHead(500); res.end();
});
// webhook receiver
const hooks: { sig: string; body: string }[] = [];
const hook = await listen(async (req, res) => { hooks.push({ sig: String(req.headers["x-qaisypro-signature"]), body: (await readBody(req)).toString() }); res.writeHead(200); res.end(); });

Object.assign(process.env, {
  DATABASE_URL: "postgres://x:x@127.0.0.1:1/x", AWS_REQUEST_CHECKSUM_CALCULATION: "WHEN_REQUIRED", GITHUB_TOKEN: "ghp_test", GITHUB_REPO: "owner/repo", GITHUB_API_URL: `http://127.0.0.1:${port(gh)}`, GITHUB_UPLOADS_URL: `http://127.0.0.1:${port(gh)}`,
  QAISYPRO_API_KEYS: "ci:0123456789abcdef0123", QAISYPRO_WEBHOOK_ALLOW_PRIVATE: "1",
});
const { default: router } = await import("../src/qaisypro/router.js");
const { default: v1 } = await import("../src/qaisypro/v1.js");
const app = express(); app.use((req: any, _r, n) => { req.session = req.headers["x-user"] ? { userId: Number(req.headers["x-user"]) } : {}; n(); });
app.use("/api", router); app.use("/api", v1);
const api = http.createServer(app); await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
const B = `http://127.0.0.1:${(api.address() as any).port}/api`;
const KEY = { "x-api-key": "0123456789abcdef0123" };
const J = (h: any) => ({ ...h, "content-type": "application/json" });

// original health route still works
assert.equal((await fetch(`${B}/qaisypro/health`)).status, 200);

// ── 1. one click: chunk-upload a 12 MB file, then send to R2 + GitHub at once ──
const file = randomBytes(12 * 1024 * 1024 + 5);
const st = await (await fetch(`${B}/qaisypro/status`, { method: "POST", headers: J(KEY), body: JSON.stringify({ fileName: "report.bin", size: file.length, lastModified: 1 }) })).json() as any;
for (let n = 1; n <= st.totalChunks; n++) { const b = file.subarray((n - 1) * st.chunkSize, n * st.chunkSize); assert.equal((await fetch(`${B}/qaisypro/chunk?sessionId=${st.sessionId}&index=${n}`, { method: "PUT", headers: { ...KEY, "x-chunk-sha256": createHash("sha256").update(b).digest("hex") }, body: b })).status, 200); }
assert.equal((await fetch(`${B}/qaisypro/complete`, { method: "POST", headers: J(KEY), body: JSON.stringify({ sessionId: st.sessionId }) })).status, 200);
// a logged-in ordinary citizen cannot spend the owner's connectors; anonymous cannot either
assert.equal((await fetch(`${B}/qaisypro/distribute`, { method: "POST", headers: J({}), body: "{}" })).status, 401);
assert.notEqual((await fetch(`${B}/qaisypro/distribute`, { method: "POST", headers: J({ "x-user": "9" }), body: JSON.stringify({ sessionId: st.sessionId, targets: ["github"] }) })).status, 200);
const d = await (await fetch(`${B}/qaisypro/distribute`, { method: "POST", headers: J(KEY), body: JSON.stringify({ sessionId: st.sessionId, targets: ["r2", "github", "telegram"] }) })).json() as any;
assert.ok(d.results, JSON.stringify(d)); const by = Object.fromEntries(d.results.map((r: any) => [r.target, r]));
assert.equal(by.r2.ok, true, JSON.stringify(by.r2)); assert.ok(by.r2.url.includes("X-Amz-Signature"));
assert.equal(by.github.ok, true, JSON.stringify(by.github)); assert.equal(by.github.mode, "file");
assert.equal(ghWrites[0].auth, "Bearer ghp_test"); assert.ok(ghWrites[0].content.equals(file), "GitHub got identical bytes");
assert.equal(by.telegram.ok, false); assert.match(by.telegram.error, /not configured/);
console.log("PASS 1-click: R2 (signed link) + GitHub (identical bytes) in one request; telegram reported unconfigured");

// GitHub release-asset path (>25 MB), streamed from R2
{ const big = randomBytes(26 * 1024 * 1024); const r = await fetch(`${B}/v1/upload?filename=big.bin`, { method: "POST", headers: { ...KEY, "content-type": "application/octet-stream" }, body: big });
  assert.equal(r.status, 201); const { key } = await r.json() as any;
  const { r2Source } = await import("../src/qaisypro/source.js"); const { distribute } = await import("../src/connectors/index.js");
  const out = await distribute(await r2Source(key, "big.bin"), ["github"]); assert.equal((out[0] as any).mode, "release-asset", JSON.stringify(out));
  assert.ok(ghWrites.at(-1)!.content.equals(big)); console.log("PASS GitHub release asset: 26 MB streamed from R2, identical"); }

// ── 2. /api/v1/upload ──
const data = randomBytes(11 * 1024 * 1024 + 3); const sha = createHash("sha256").update(data).digest("hex");
assert.equal((await fetch(`${B}/v1/upload?filename=a.bin`, { method: "POST", body: data })).status, 401);
assert.equal((await fetch(`${B}/v1/upload?filename=a.bin`, { method: "POST", headers: { "x-api-key": "wrong-wrong-wrong-wrong" }, body: data })).status, 401);
assert.equal((await fetch(`${B}/v1/upload?filename=a.bin`, { method: "POST", headers: { ...KEY, "x-content-sha256": "0".repeat(64) }, body: data })).status, 422);
assert.equal((await fetch(`${B}/v1/upload?filename=a.bin`, { method: "POST", headers: { ...KEY, "content-type": "application/json" }, body: "{}" })).status, 415);
process.env.QAISYPRO_WEBHOOK_ALLOW_PRIVATE = "0";
assert.equal((await fetch(`${B}/v1/upload?filename=a.bin&webhook=${encodeURIComponent("http://127.0.0.1:1/x")}`, { method: "POST", headers: KEY, body: data })).status, 400);
assert.equal((await fetch(`${B}/v1/upload?filename=a.bin&webhook=${encodeURIComponent("https://localhost/x")}`, { method: "POST", headers: KEY, body: data })).status, 400);
process.env.QAISYPRO_WEBHOOK_ALLOW_PRIVATE = "1";
const up = await fetch(`${B}/v1/upload?filename=a.bin&webhook=${encodeURIComponent(`http://127.0.0.1:${port(hook)}/h`)}`, { method: "POST", headers: { ...KEY, "x-content-sha256": sha, "content-type": "application/octet-stream" }, body: data });
assert.equal(up.status, 201); const r1 = await up.json() as any; assert.equal(r1.sha256, sha); assert.equal(r1.size, data.length);
const stored = objects.get(`t/${r1.key}`) as Buffer; assert.ok(stored.equals(data), "multipart v1 upload byte-identical");
for (let i = 0; i < 40 && !hooks.length; i++) await new Promise((r) => setTimeout(r, 50));
assert.equal(hooks.length, 1); assert.equal(hooks[0].sig, "sha256=" + createHmac("sha256", "0123456789abcdef0123").update(hooks[0].body).digest("hex"));
assert.equal(JSON.parse(hooks[0].body).event, "upload.complete");
const tiny = await fetch(`${B}/v1/upload?filename=t.txt`, { method: "POST", headers: KEY, body: "hi" }); assert.equal(tiny.status, 201);
console.log("PASS /api/v1/upload: key auth, 11 MB multipart identical, sha check, SSRF blocked, HMAC webhook delivered");

// ── 3. stats ──
const s1 = await (await fetch(`${B}/qaisypro/stats`, { headers: KEY })).json() as any;
await new Promise((r) => setTimeout(r, 500));
const s2 = await (await fetch(`${B}/qaisypro/stats`, { headers: KEY })).json() as any;
assert.ok(s2.speed.bytesPerSecond > 0); assert.ok(s2.r2Storage.bytes > 0, JSON.stringify(s2.r2Storage)); assert.equal(s2.cdn.configured, false);
assert.equal((await fetch(`${B}/qaisypro/stats`)).status, 401); void s1;
const cons = await (await fetch(`${B}/qaisypro/connectors`, { headers: KEY })).json() as any;
assert.deepEqual(cons.connectors.map((c: any) => c.name), ["r2", "github", "drive", "telegram", "railway", "vercel"]);
console.log("PASS stats:", JSON.stringify({ speed: s2.speed.bytesPerSecond, r2: s2.r2Storage.bytes, cdn: s2.cdn, rssMB: s2.memory.rssMB }));

// ── 4. failover ──
const mk = () => listen((q, r) => { r.writeHead(200); r.end("{}"); });
const primary = await mk(), backup = await mk();
process.env.QAISYPRO_SERVERS = `http://127.0.0.1:${port(primary)},http://127.0.0.1:${port(backup)}`; process.env.QAISYPRO_HEALTH_INTERVAL_MS = "200";
const fo = await import("../src/qaisypro/failover.js"); fo.startFailover(); await new Promise((r) => setTimeout(r, 400));
assert.equal(fo.failoverState().failedOver, false);
primary.close(); primary.closeAllConnections(); const t0 = Date.now();
while (!fo.failoverState().failedOver && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
assert.equal(fo.failoverState().active, `http://127.0.0.1:${port(backup)}`);
console.log(`PASS failover: primary killed, switched to backup in ${Date.now() - t0} ms (interval 200 ms in test, 10 s default)`);
fo.stopFailover(); s3.close(); process.exit(0);
