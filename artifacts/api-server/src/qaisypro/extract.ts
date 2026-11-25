// QAISYPRO Extract — streaming extractors (ZIP, TAR, TAR.GZ, GZ, 7z, RAR, others via bsdtar).
// Pipeline per file: extract to tmp -> upload to R2 -> delete tmp -> next. 3 files in flight.
// RAM is bounded by (3 files x one 10 MB part) + stream buffers; archive size is never held in memory.
import { createWriteStream } from "node:fs";
import { mkdir, open, readFile, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { PassThrough, Readable, Writable } from "node:stream";
import zlib from "node:zlib";
import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand,
  GetObjectCommand, PutObjectCommand, UploadPartCommand,
} from "@aws-sdk/client-s3";
import { r2Client, r2Config } from "../lib/r2-storage.js";
import { type Session } from "./upload-core.js";

export const PARALLEL_FILES = 3;
const PART_BYTES = 5 * 1024 * 1024; // R2 minimum part size
const bucket = () => r2Config()!.bucket;

export type Job = {
  id: string; userId: number | string; sessionId: string; format: string;
  state: "running" | "done" | "failed"; files: number; bytes: number;
  failed: { name: string; error: string }[]; error?: string; outputPrefix: string;
  startedAt: string; finishedAt?: string; peakRssMb: number; maxTmpFiles: number;
};
export const jobs = new Map<string, Job>();
export const extractStats = { files: 0, bytes: 0, running: 0 };

export const safeName = (p: string) =>
  path.posix.normalize(p.replace(/\\/g, "/")).split("/").filter((s) => s && s !== ".." && s !== ".").join("/");

class Gate {
  private waiting: (() => void)[] = []; private n = 0;
  constructor(private max: number) {}
  async acquire() { if (this.n < this.max) { this.n++; return; } await new Promise<void>((r) => this.waiting.push(r)); }
  release() { const w = this.waiting.shift(); if (w) w(); else this.n--; }
}

// Exact-length reader over an async byte source, O(1) memory.
class Reader {
  private it: AsyncIterator<Buffer>; private buf: Buffer = Buffer.alloc(0);
  constructor(src: AsyncIterable<Buffer>) { this.it = src[Symbol.asyncIterator](); }
  private async fill() {
    const r = await this.it.next(); if (r.done) return false;
    this.buf = this.buf.length ? Buffer.concat([this.buf, r.value]) : r.value; return true;
  }
  async read(n: number): Promise<Buffer | null> {
    while (this.buf.length < n) if (!(await this.fill())) break;
    if (this.buf.length < n) { if (!this.buf.length) return null; throw new Error("archive truncated"); }
    const out = this.buf.subarray(0, n); this.buf = this.buf.subarray(n); return out;
  }
  async skip(n: number) { let left = n; while (left > 0) { if (!this.buf.length && !(await this.fill())) throw new Error("archive truncated"); const t = Math.min(left, this.buf.length); this.buf = this.buf.subarray(t); left -= t; } }
  async copy(n: number, ws: Writable) {
    let left = n;
    while (left > 0) {
      if (!this.buf.length && !(await this.fill())) throw new Error("archive truncated");
      const t = Math.min(left, this.buf.length); const part = this.buf.subarray(0, t); this.buf = this.buf.subarray(t); left -= t;
      if (!ws.write(part)) await once(ws, "drain");
    }
  }
}

async function getStream(key: string, range?: string): Promise<Readable> {
  const r = await r2Client().send(new GetObjectCommand({ Bucket: bucket(), Key: key, Range: range }));
  return r.Body as Readable;
}

async function putFile(key: string, file: string, size: number) {
  const c = r2Client(), Bucket = bucket();
  if (size <= PART_BYTES) { await c.send(new PutObjectCommand({ Bucket, Key: key, Body: await readFile(file) })); return; }
  const part = Math.max(PART_BYTES, Math.ceil(size / 10_000 / 1048576) * 1048576); // 5 MiB parts keep RAM low; grows past 10,000 parts: no size ceiling
  const { UploadId } = await c.send(new CreateMultipartUploadCommand({ Bucket, Key: key }));
  const fh = await open(file, "r");
  try {
    const parts: { PartNumber: number; ETag: string }[] = [];
    for (let off = 0, n = 1; off < size; off += part, n++) {
      const buf = Buffer.allocUnsafe(Math.min(part, size - off));
      await fh.read(buf, 0, buf.length, off);
      for (let a = 0; ; a++) {
        try { const r = await c.send(new UploadPartCommand({ Bucket, Key: key, UploadId, PartNumber: n, Body: buf })); parts.push({ PartNumber: n, ETag: r.ETag! }); break; }
        catch (e) { if (a >= 3) throw e; await new Promise((r) => setTimeout(r, 500 * 2 ** a)); }
      }
    }
    await c.send(new CompleteMultipartUploadCommand({ Bucket, Key: key, UploadId, MultipartUpload: { Parts: parts } }));
  } catch (e) { await c.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId })).catch(() => {}); throw e; }
  finally { await fh.close(); }
}

type Ctx = { job: Job; dir: string; gate: Gate; tasks: Promise<void>[]; tmpOpen: number };

// extract one entry: produce(tmpPath) writes the bytes; then upload; then delete.
function ship(ctx: Ctx, name: string, produce: (tmp: string) => Promise<void>): Promise<void> {
  const clean = safeName(name);
  const tmp = path.join(ctx.dir, randomUUID());
  const run = (async () => {
    ctx.tmpOpen++; ctx.job.maxTmpFiles = Math.max(ctx.job.maxTmpFiles, ctx.tmpOpen);
    try {
      await produce(tmp);
      const size = (await stat(tmp)).size;
      await putFile(`${ctx.job.outputPrefix}${clean}`, tmp, size);
      ctx.job.files++; ctx.job.bytes += size; extractStats.files++; extractStats.bytes += size;
    } catch (e: any) { ctx.job.failed.push({ name: clean, error: String(e?.message ?? e).slice(0, 200) }); }
    finally { ctx.tmpOpen--; await unlink(tmp).catch(() => {}); }
  })();
  return run;
}
// Acquire a slot BEFORE reading the next entry's bytes: this is the back-pressure that bounds disk and RAM.
async function dispatch(ctx: Ctx, name: string, produce: (tmp: string) => Promise<void>) {
  if (!safeName(name)) return;
  await ctx.gate.acquire();
  ctx.tasks.push(ship(ctx, name, produce).finally(() => ctx.gate.release()));
}

// ── ZIP (ZIP64, stored + deflate), reads central directory and files by R2 range requests ──
async function extractZip(ctx: Ctx, key: string, size: number) {
  const range = (a: number, b: number) => getStream(key, `bytes=${a}-${b}`);
  const readAll = async (a: number, b: number) => { const chunks: Buffer[] = []; for await (const c of await range(a, b)) chunks.push(c); return Buffer.concat(chunks); };
  const tailLen = Math.min(size, 65557 + 20 + 56);
  const tail = await readAll(size - tailLen, size - 1);
  let e = tail.length - 22; while (e >= 0 && tail.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("not a ZIP (end record not found)");
  let cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16), total = tail.readUInt16LE(e + 10);
  if ((cdOff === 0xffffffff || cdSize === 0xffffffff || total === 0xffff) && e >= 20 && tail.readUInt32LE(e - 20) === 0x07064b50) {
    const z64 = Number(tail.readBigUInt64LE(e - 20 + 8));
    const rec = await readAll(z64, z64 + 55);
    if (rec.readUInt32LE(0) !== 0x06064b50) throw new Error("bad ZIP64 record");
    total = Number(rec.readBigUInt64LE(32)); cdSize = Number(rec.readBigUInt64LE(40)); cdOff = Number(rec.readBigUInt64LE(48));
  }
  const cd = new Reader(await range(cdOff, cdOff + cdSize - 1));
  for (;;) {
    const h = await cd.read(46); if (!h || h.readUInt32LE(0) !== 0x02014b50) break;
    const flags = h.readUInt16LE(8), method = h.readUInt16LE(10);
    let comp = h.readUInt32LE(20), uncomp = h.readUInt32LE(24), off = h.readUInt32LE(42);
    const nl = h.readUInt16LE(28), xl = h.readUInt16LE(30), cl = h.readUInt16LE(32);
    const name = (await cd.read(nl))!.toString("utf8"); const extra = xl ? (await cd.read(xl))! : Buffer.alloc(0); if (cl) await cd.skip(cl);
    if (comp === 0xffffffff || uncomp === 0xffffffff || off === 0xffffffff) {
      for (let p = 0; p + 4 <= extra.length;) {
        const id = extra.readUInt16LE(p), len = extra.readUInt16LE(p + 2);
        if (id === 1) { let q = p + 4; if (uncomp === 0xffffffff) { uncomp = Number(extra.readBigUInt64LE(q)); q += 8; } if (comp === 0xffffffff) { comp = Number(extra.readBigUInt64LE(q)); q += 8; } if (off === 0xffffffff) off = Number(extra.readBigUInt64LE(q)); }
        p += 4 + len;
      }
    }
    if (name.endsWith("/")) continue;
    await dispatch(ctx, name, async (tmp) => {
      if (flags & 1) throw new Error("encrypted entries are not supported");
      if (method !== 0 && method !== 8) throw new Error(`unsupported ZIP method ${method}`);
      const lh = await readAll(off, off + 29);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error("bad local header");
      const start = off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const src = comp === 0 ? Readable.from([]) : await range(start, start + comp - 1);
      await pipeline(src, ...(method === 8 ? [zlib.createInflateRaw()] : []), createWriteStream(tmp));
      if ((await stat(tmp)).size !== uncomp) throw new Error("size mismatch (corrupt entry)");
    });
  }
  void total;
}

// ── TAR (ustar, pax, GNU long names, base-256 sizes) over any byte stream ──
async function extractTar(ctx: Ctx, src: AsyncIterable<Buffer>) {
  const r = new Reader(src);
  const str = (b: Buffer, a: number, n: number) => { const s = b.subarray(a, a + n); const z = s.indexOf(0); return s.subarray(0, z < 0 ? n : z).toString("utf8"); };
  let longName: string | null = null, paxPath: string | null = null, paxSize: number | null = null;
  for (;;) {
    const h = await r.read(512); if (!h) break;
    if (h.every((x) => x === 0)) continue;
    let size = (h[124] & 0x80) ? Number(h.readBigUInt64BE(128) & 0x7fffffffffffffffn) : parseInt(str(h, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 48);
    const pad = (512 - (size % 512)) % 512;
    if (type === "L" || type === "x" || type === "g") {
      const body = (await r.read(size))!; if (pad) await r.skip(pad);
      if (type === "L") longName = body.toString("utf8").replace(/\0+$/, "");
      if (type === "x") for (const m of body.toString("utf8").matchAll(/\d+ (\w+)=([^\n]*)\n/g)) { if (m[1] === "path") paxPath = m[2]; if (m[1] === "size") paxSize = Number(m[2]); }
      continue;
    }
    if (paxSize !== null) size = paxSize;
    const ustar = str(h, 257, 5) === "ustar"; const prefix = ustar ? str(h, 345, 155) : "";
    const name = paxPath ?? longName ?? (prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100));
    longName = paxPath = null; paxSize = null;
    const padding = (512 - (size % 512)) % 512;
    if (type === "0" || type === "7") {
      await ctx.gate.acquire(); // slot first, then consume the bytes
      const tmp = path.join(ctx.dir, randomUUID());
      const clean = safeName(name);
      if (!clean) { ctx.gate.release(); await r.skip(size); if (padding) await r.skip(padding); continue; }
      const ws = createWriteStream(tmp); await r.copy(size, ws); ws.end(); await once(ws, "finish");
      if (padding) await r.skip(padding);
      ctx.tasks.push(ship(ctx, clean, async (t) => { const { rename } = await import("node:fs/promises"); await rename(tmp, t); }).finally(() => ctx.gate.release()));
    } else { await r.skip(size + padding); }
  }
}

// ── 7z / RAR / everything else: bsdtar (libarchive) ──
const esc = (s: string) => s.replace(/[\\*?\[\]]/g, "\\$&");
const run = (cmd: string, args: string[]) => spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C.UTF-8" } });
async function extractLibarchive(ctx: Ctx, key: string, fileName: string) {
  const arc = path.join(ctx.dir, `archive${path.extname(fileName)}`);
  await pipeline(await getStream(key), createWriteStream(arc)); // to disk, never to RAM
  const names: string[] = [];
  const lister = run("bsdtar", ["-tf", arc]); let err = "";
  lister.stderr.on("data", (d) => (err += d));
  const exited = new Promise<number>((res) => lister.on("close", res));
  let rest = "";
  for await (const c of lister.stdout) { rest += c; const parts = rest.split("\n"); rest = parts.pop()!; for (const p of parts) if (p && !p.endsWith("/")) names.push(p); }
  if (rest && !rest.endsWith("/")) names.push(rest);
  if ((await exited) !== 0 && !names.length) throw new Error(`cannot read archive: ${err.slice(0, 200)}`);
  for (const n of names) {
    await dispatch(ctx, n, async (tmp) => {
      const p = run("bsdtar", ["-xOf", arc, "--", esc(n)]); let e2 = "";
      p.stderr.on("data", (d) => (e2 += d));
      const code = new Promise<number>((res) => p.on("close", res));
      await pipeline(p.stdout, createWriteStream(tmp));
      if ((await code) !== 0) throw new Error(e2.slice(0, 200) || "extract failed");
    });
  }
}

export function detectFormat(name: string): "zip" | "tar" | "tgz" | "gz" | "libarchive" {
  const n = name.toLowerCase();
  if (n.endsWith(".zip")) return "zip";
  if (n.endsWith(".tar")) return "tar";
  if (n.endsWith(".tar.gz") || n.endsWith(".tgz")) return "tgz";
  if (n.endsWith(".gz")) return "gz";
  return "libarchive"; // .7z .rar .tar.bz2 .tar.xz ...
}

export function startExtract(s: Session): Job {
  const format = detectFormat(s.fileName);
  const job: Job = {
    id: randomUUID().replace(/-/g, ""), userId: s.userId, sessionId: s.id, format, state: "running", files: 0, bytes: 0, failed: [],
    outputPrefix: `qaisypro/extracted/${s.id}/`, startedAt: new Date().toISOString(), peakRssMb: 0, maxTmpFiles: 0,
  };
  jobs.set(job.id, job); extractStats.running++;
  const sampler = setInterval(() => { job.peakRssMb = Math.max(job.peakRssMb, Math.round(process.memoryUsage().rss / 1048576)); }, 250);
  (async () => {
    const dir = path.join(tmpdir(), `qaisypro-${job.id}`); await mkdir(dir, { recursive: true });
    const ctx: Ctx = { job, dir, gate: new Gate(PARALLEL_FILES), tasks: [], tmpOpen: 0 };
    try {
      if (format === "zip") await extractZip(ctx, s.key, s.size);
      else if (format === "tar") await extractTar(ctx, await getStream(s.key));
      else if (format === "tgz") await extractTar(ctx, (await getStream(s.key)).pipe(zlib.createGunzip()));
      else if (format === "gz") {
        const out = s.fileName.replace(/\.gz$/i, "") || "file";
        await dispatch(ctx, out, async (tmp) => { await pipeline(await getStream(s.key), zlib.createGunzip(), createWriteStream(tmp)); });
      } else await extractLibarchive(ctx, s.key, s.fileName);
      await Promise.all(ctx.tasks);
      job.state = "done";
    } catch (e: any) { await Promise.allSettled(ctx.tasks); job.state = "failed"; job.error = String(e?.message ?? e).slice(0, 300); }
    finally { clearInterval(sampler); extractStats.running--; job.finishedAt = new Date().toISOString(); await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  })();
  return job;
}
void PassThrough;
