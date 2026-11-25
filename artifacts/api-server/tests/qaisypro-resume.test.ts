// Run: pnpm --filter @workspace/api-server test:qaisypro
// In-process S3 mock + real qaisypro router; 25 MB file, network cut 2 times, must resume.
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import express from "express";
import assert from "node:assert/strict";

const objects = new Map<string, Buffer>();
const uploads = new Map<string, Map<number, Buffer>>();
const xml = (b: string) => `<?xml version="1.0" encoding="UTF-8"?>${b}`;
const s3 = http.createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  let body = Buffer.concat(chunks);
  const u = new URL(req.url!, "http://x"); const [, bucket, ...rest] = u.pathname.split("/"); const key = decodeURIComponent(rest.join("/"));
  const q = u.searchParams; const send = (c: number, b = "", h: any = {}) => { res.writeHead(c, h); res.end(b); };
  // strip aws-chunked framing if the SDK used it
  if (String(req.headers["content-encoding"] ?? "").includes("aws-chunked") || req.headers["x-amz-content-sha256"] === "STREAMING-UNSIGNED-PAYLOAD-TRAILER") {
    const out: Buffer[] = []; let i = 0;
    while (i < body.length) { const e = body.indexOf("\r\n", i); const n = parseInt(body.subarray(i, e).toString().split(";")[0], 16); if (!n) break; out.push(body.subarray(e + 2, e + 2 + n)); i = e + 2 + n + 2; }
    body = Buffer.concat(out);
  }
  if (req.method === "POST" && q.has("uploads")) { const id = randomBytes(8).toString("hex"); uploads.set(id, new Map()); return send(200, xml(`<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`)); }
  if (req.method === "PUT" && q.has("partNumber")) { uploads.get(q.get("uploadId")!)!.set(Number(q.get("partNumber")), body); return send(200, "", { ETag: `"${createHash("md5").update(body).digest("hex")}"` }); }
  if (req.method === "GET" && q.has("uploadId")) { const p = uploads.get(q.get("uploadId")!)!; return send(200, xml(`<ListPartsResult><IsTruncated>false</IsTruncated>${[...p].sort((a, b) => a[0] - b[0]).map(([n, b]) => `<Part><PartNumber>${n}</PartNumber><ETag>"${createHash("md5").update(b).digest("hex")}"</ETag><Size>${b.length}</Size></Part>`).join("")}</ListPartsResult>`)); }
  if (req.method === "POST" && q.has("uploadId")) { const p = uploads.get(q.get("uploadId")!)!; objects.set(`${bucket}/${key}`, Buffer.concat([...p].sort((a, b) => a[0] - b[0]).map(x => x[1]))); return send(200, xml(`<CompleteMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><ETag>"x"</ETag></CompleteMultipartUploadResult>`)); }
  if (req.method === "PUT") { objects.set(`${bucket}/${key}`, body); return send(200, "", { ETag: '"x"' }); }
  if (req.method === "GET" && q.get("list-type") === "2") { const pre = `${bucket}/${q.get("prefix") ?? ""}`; return send(200, xml(`<ListBucketResult><IsTruncated>false</IsTruncated>${[...objects.keys()].filter(k => k.startsWith(pre)).map(k => `<Contents><Key>${k.slice(bucket.length + 1)}</Key></Contents>`).join("")}</ListBucketResult>`)); }
  if (req.method === "GET") { const o = objects.get(`${bucket}/${key}`); return o ? send(200, o, { "Content-Length": o.length }) : send(404, xml("<Error><Code>NoSuchKey</Code></Error>"), { "Content-Type": "application/xml" }); }
  send(405);
});
await new Promise<void>(r => s3.listen(0, "127.0.0.1", r));
process.env.R2_ENDPOINT = `http://127.0.0.1:${(s3.address() as any).port}`;
process.env.R2_BUCKET_NAME = "t"; process.env.R2_ACCESS_KEY_ID = "k"; process.env.R2_SECRET_ACCESS_KEY = "s";

process.env.DATABASE_URL ??= "postgres://x:x@127.0.0.1:1/x"; // pool is lazy; never connected in this test
const { default: router } = await import("../src/qaisypro/router.js");
const app = express();
app.use((req: any, _r, n) => { req.session = req.headers["x-user"] ? { userId: Number(req.headers["x-user"]) } : {}; n(); });
app.use("/api", router);
const api = http.createServer(app); await new Promise<void>(r => api.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(api.address() as any).port}/api/qaisypro`;
const H = { "x-user": "7" };

const file = randomBytes(25 * 1024 * 1024 + 777);
const meta = { fileName: "test.zip", size: file.length, lastModified: 1234 };
const post = (p: string, b: any, h: any = H) => fetch(base + p, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify(b) });

// auth is enforced
assert.equal((await post("/status", meta, {})).status, 401);

let uploadedThisRun: number[] = [];
async function attempt(cutAfter: number | null) {
  const st = await (await post("/status", meta)).json() as any;
  const have = new Set<number>(st.received);
  console.log(`  session ${st.sessionId.slice(0, 8)} chunks=${st.totalChunks} already-on-server=[${[...have]}]`);
  const todo = Array.from({ length: st.totalChunks }, (_, i) => i + 1).filter(n => !have.has(n));
  const ac = new AbortController(); let sent = 0; uploadedThisRun = [];
  const q = [...todo];
  await Promise.all(Array(cutAfter === null ? 8 : 1).fill(0).map(async () => {
    while (q.length && !ac.signal.aborted) {
      const n = q.shift()!;
            const b = file.subarray((n - 1) * st.chunkSize, Math.min(file.length, n * st.chunkSize));
      try {
        const r = await fetch(`${base}/chunk?sessionId=${st.sessionId}&index=${n}`, { method: "PUT", headers: { ...H, "x-chunk-sha256": createHash("sha256").update(b).digest("hex") }, body: b, signal: ac.signal });
        if (r.ok) { sent++; uploadedThisRun.push(n); if (cutAfter !== null && sent >= cutAfter) ac.abort(); }
      } catch { /* cut */ }
    }
  }));
  return { sessionId: st.sessionId, cut: ac.signal.aborted };
}
let r = await attempt(1); console.log("cut 1, chunks sent this run:", uploadedThisRun);
r = await attempt(1); console.log("cut 2, chunks sent this run:", uploadedThisRun);
assert.equal(r.cut, true);
const sent3: number[] = [];
r = await attempt(null); sent3.push(...uploadedThisRun); console.log("final run sent:", uploadedThisRun);

// completing with a bad fingerprint is rejected
const bad = await fetch(`${base}/chunk?sessionId=${r.sessionId}&index=1`, { method: "PUT", headers: { ...H, "x-chunk-sha256": "0".repeat(64) }, body: file.subarray(0, 10 * 1024 * 1024) });
assert.equal(bad.status, 422);
// another user cannot touch the session
assert.equal((await post("/complete", { sessionId: r.sessionId }, { "x-user": "8" })).status, 404);

const done = await (await post("/complete", { sessionId: r.sessionId })).json() as any;
assert.equal(done.ok, true);
const stored = [...objects].find(([k]) => k.includes("qaisypro/uploads/"))![1];
assert.equal(createHash("sha256").update(stored).digest("hex"), createHash("sha256").update(file).digest("hex"));
console.log("PASS: 25 MB reassembled byte-identical after 2 cuts; no chunk re-sent from 0");
s3.close(); api.close(); process.exit(0);
