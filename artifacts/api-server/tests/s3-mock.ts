// Minimal in-process S3 (multipart, range GET, list). Objects may be file-backed so huge archives never sit in RAM.
import http from "node:http";
import fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
export type Obj = Buffer | { file: string; size: number } | { sha: string; size: number };
export const objects = new Map<string, Obj>();
const uploads = new Map<string, Map<number, Buffer>>();
// sink prefix: keep only sha+size (so RAM tests measure the code under test, not the mock)
export const sinkPrefixes: string[] = [];
const xml = (b: string) => `<?xml version="1.0" encoding="UTF-8"?>${b}`;
export async function startS3() {
  const s3 = http.createServer(async (req, res) => {
    const u = new URL(req.url!, "http://x"); const [, bucket, ...rest] = u.pathname.split("/"); const key = decodeURIComponent(rest.join("/"));
    const full = `${bucket}/${key}`; const q = u.searchParams;
    const send = (c: number, b: any = "", h: any = {}) => { res.writeHead(c, h); res.end(b); };
    const sink = sinkPrefixes.some((p) => full.startsWith(`${bucket}/${p}`));
    const hasher = createHash("sha256"); let sz = 0; const chunks: Buffer[] = [];
    const isAwsChunked = String(req.headers["content-encoding"] ?? "").includes("aws-chunked") || req.headers["x-amz-content-sha256"] === "STREAMING-UNSIGNED-PAYLOAD-TRAILER";
    const isWrite = req.method === "PUT" || (req.method === "POST");
    if (isWrite && sink && !isAwsChunked && !q.has("uploadId") && !q.has("uploads")) { // streamed sink for PutObject
      for await (const c of req) { hasher.update(c as Buffer); sz += (c as Buffer).length; }
      objects.set(full, { sha: hasher.digest("hex"), size: sz }); return send(200, "", { ETag: '"x"' });
    }
    for await (const c of req) chunks.push(c as Buffer);
    let body = Buffer.concat(chunks);
    if (isAwsChunked) { const out: Buffer[] = []; let i = 0; while (i < body.length) { const e = body.indexOf("\r\n", i); const n = parseInt(body.subarray(i, e).toString().split(";")[0], 16); if (!n) break; out.push(body.subarray(e + 2, e + 2 + n)); i = e + 2 + n + 2; } body = Buffer.concat(out); }
    if (req.method === "POST" && q.has("uploads")) { const id = randomBytes(8).toString("hex"); uploads.set(id, new Map()); return send(200, xml(`<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`)); }
    if (req.method === "PUT" && q.has("partNumber")) { uploads.get(q.get("uploadId")!)!.set(Number(q.get("partNumber")), sink ? Buffer.from(createHash("sha256").update(body).digest()) : body); if (sink) (uploads.get(q.get("uploadId")!) as any).sizes = ((uploads.get(q.get("uploadId")!) as any).sizes ?? 0) + body.length; return send(200, "", { ETag: `"${createHash("md5").update(body).digest("hex")}"` }); }
    if (req.method === "GET" && q.has("uploadId")) { const p = uploads.get(q.get("uploadId")!)!; return send(200, xml(`<ListPartsResult><IsTruncated>false</IsTruncated>${[...p].sort((a, b) => a[0] - b[0]).map(([n, b]) => `<Part><PartNumber>${n}</PartNumber><ETag>"x${n}"</ETag><Size>${b.length}</Size></Part>`).join("")}</ListPartsResult>`)); }
    if (req.method === "POST" && q.has("uploadId")) { const p = uploads.get(q.get("uploadId")!)!; const parts = [...p].sort((a, b) => a[0] - b[0]).map((x) => x[1]); objects.set(full, sink ? { sha: createHash("sha256").update(Buffer.concat(parts)).digest("hex"), size: (p as any).sizes } : Buffer.concat(parts)); return send(200, xml(`<CompleteMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><ETag>"x"</ETag></CompleteMultipartUploadResult>`)); }
    if (req.method === "PUT") { objects.set(full, body); return send(200, "", { ETag: '"x"' }); }
    if (req.method === "GET" && q.get("list-type") === "2") { const pre = `${bucket}/${q.get("prefix") ?? ""}`; return send(200, xml(`<ListBucketResult><IsTruncated>false</IsTruncated>${[...objects.keys()].filter((k) => k.startsWith(pre)).map((k) => `<Contents><Key>${k.slice(bucket.length + 1)}</Key></Contents>`).join("")}</ListBucketResult>`)); }
    if (req.method === "GET") {
      const o = objects.get(full); if (!o) return send(404, xml("<Error><Code>NoSuchKey</Code></Error>"), { "Content-Type": "application/xml" });
      const size = Buffer.isBuffer(o) ? o.length : o.size; let a = 0, b = size - 1;
      const m = /bytes=(\d+)-(\d*)/.exec(String(req.headers.range ?? "")); if (m) { a = +m[1]; b = m[2] ? Math.min(+m[2], size - 1) : size - 1; }
      const h = { "Content-Length": b - a + 1, ...(m ? { "Content-Range": `bytes ${a}-${b}/${size}` } : {}) };
      res.writeHead(m ? 206 : 200, h);
      if (Buffer.isBuffer(o)) return void res.end(o.subarray(a, b + 1));
      if ("file" in o) return void fs.createReadStream(o.file, { start: a, end: b }).pipe(res);
      return void res.end();
    }
    send(405);
  });
  await new Promise<void>((r) => s3.listen(0, "127.0.0.1", r));
  process.env.R2_ENDPOINT = `http://127.0.0.1:${(s3.address() as any).port}`;
  process.env.R2_BUCKET_NAME = "t"; process.env.R2_ACCESS_KEY_ID = "k"; process.env.R2_SECRET_ACCESS_KEY = "s";
  return s3;
}
