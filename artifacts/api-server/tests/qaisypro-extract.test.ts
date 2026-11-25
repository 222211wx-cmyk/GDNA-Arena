// Formats test: zip (deflate+stored), tar, tar.gz, gz, 7z, tar.bz2 — all extracted file-by-file into the R2 mock.
import { execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import { objects, startS3 } from "./s3-mock.js";
const s3 = await startS3();
const { startExtract, jobs } = await import("../src/qaisypro/extract.js");

const W = "/tmp/qx"; fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(`${W}/src/dir/sub`, { recursive: true });
const files: Record<string, Buffer> = {
  "a.txt": Buffer.from("hello"), "empty.bin": Buffer.alloc(0), "dir/b.bin": randomBytes(3_000_000),
  "dir/sub/big.bin": Buffer.concat([randomBytes(1_000_000), Buffer.alloc(11_500_000, 7)]), // 12.5 MB -> multipart upload path
  "dir/sub/ملف عربي.txt": Buffer.from("مرحبا"),
};
for (let i = 0; i < 30; i++) files[`many/f${i}.dat`] = randomBytes(1000 + i * 977);
for (const [n, b] of Object.entries(files)) { fs.mkdirSync(path.dirname(`${W}/src/${n}`), { recursive: true }); fs.writeFileSync(`${W}/src/${n}`, b); }
const sh = (c: string) => execSync(c, { cwd: `${W}/src`, stdio: "pipe" });
sh(`python3 -c "import zipfile,os;z=zipfile.ZipFile('../t.zip','w',zipfile.ZIP_DEFLATED);[z.write(os.path.join(r,f),os.path.join(r,f)[2:]) for r,_,fs in os.walk('.') for f in fs];z.writestr('stored.txt','st',compress_type=zipfile.ZIP_STORED);z.close()"`);
sh("tar -cf ../t.tar .; tar -czf ../t.tar.gz .; tar -cjf ../t.tar.bz2 .; 7z a -bd ../t.7z . >/dev/null");
fs.writeFileSync(`${W}/one.txt`, "gzip me"); sh(`gzip -k ${W}/one.txt`);
const expected = new Map(Object.entries(files).map(([n, b]) => [n, createHash("sha256").update(b).digest("hex")]));

for (const [fileName, extra] of [["t.zip", { "stored.txt": "st" }], ["t.tar", {}], ["t.tar.gz", {}], ["t.tar.bz2", {}], ["t.7z", {}]] as const) {
  const buf = fs.readFileSync(`${W}/${fileName}`); const key = `qaisypro/uploads/${fileName}/${fileName}`;
  objects.set(`t/${key}`, buf);
  const job = startExtract({ id: fileName.replace(/\W/g, ""), userId: 1, key, uploadId: "", fileName, size: buf.length, chunkSize: 0, totalChunks: 1, contentType: "", createdAt: "" });
  while (jobs.get(job.id)!.state === "running") await new Promise((r) => setTimeout(r, 50));
  assert.equal(job.state, "done", `${fileName}: ${job.error}`);
  assert.deepEqual(job.failed, [], fileName);
  const got = [...objects].filter(([k]) => k.startsWith(`t/${job.outputPrefix}`));
  const exp = new Map(expected); for (const [n, v] of Object.entries(extra)) exp.set(n, createHash("sha256").update(v).digest("hex"));
  assert.equal(got.length, exp.size, `${fileName}: file count ${got.length} vs ${exp.size}`);
  for (const [k, o] of got) { const n = k.slice(`t/${job.outputPrefix}`.length); assert.equal(createHash("sha256").update(o as Buffer).digest("hex"), exp.get(n), `${fileName}: ${n} differs`); }
  assert.ok(job.maxTmpFiles <= 3, `max tmp files ${job.maxTmpFiles}`);
  assert.ok(!fs.existsSync(`/tmp/qaisypro-${job.id}`), "tmp dir cleaned");
  console.log(`PASS ${fileName}: ${job.files} files identical, peak tmp files ${job.maxTmpFiles}`);
}
// plain .gz
{ const buf = fs.readFileSync(`${W}/one.txt.gz`); objects.set("t/k/one.txt.gz", buf);
  const job = startExtract({ id: "gz1", userId: 1, key: "k/one.txt.gz", uploadId: "", fileName: "one.txt.gz", size: buf.length, chunkSize: 0, totalChunks: 1, contentType: "", createdAt: "" });
  while (job.state === "running") await new Promise((r) => setTimeout(r, 50));
  assert.equal(job.state, "done", job.error); assert.equal((objects.get(`t/${job.outputPrefix}one.txt`) as Buffer).toString(), "gzip me"); console.log("PASS one.txt.gz"); }
s3.close(); process.exit(0);
