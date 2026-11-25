// Browser client source (served as text at GET /api/qaisypro/client.js).
export const CLIENT_JS = `
// QAISYPRO resumable uploader: slice -> fingerprint -> send 8 in parallel -> retry 5x -> resume forever.
export async function qaisyproUpload(file, { onProgress, base = "/api/qaisypro", parallel = 8, retries = 5 } = {}) {
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const json = async (p, body) => { const r = await fetch(base + p, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status); return r.json(); };
  let st;
  for (let i = 0; ; i++) { try { st = await json("/status", { fileName: file.name, size: file.size, lastModified: file.lastModified, contentType: file.type }); break; } catch (e) { if (i >= retries) throw e; await sleep(1000 * 2 ** i); } }
  const done = new Set(st.received); let bytes = 0;
  const lenOf = (n) => Math.min(file.size, n * st.chunkSize) - (n - 1) * st.chunkSize;
  for (const n of done) bytes += lenOf(n);
  onProgress?.(bytes / file.size);
  const queue = []; for (let n = 1; n <= st.totalChunks; n++) if (!done.has(n)) queue.push(n);
  async function send(n) {
    const blob = file.slice((n - 1) * st.chunkSize, Math.min(file.size, n * st.chunkSize));
    const buf = await blob.arrayBuffer(); const sha = hex(await crypto.subtle.digest("SHA-256", buf));
    for (let a = 0; ; a++) {
      try {
        const r = await fetch(base + "/chunk?sessionId=" + st.sessionId + "&index=" + n, { method: "PUT", credentials: "include", headers: { "x-chunk-sha256": sha }, body: buf });
        if (r.ok) { bytes += buf.byteLength; onProgress?.(bytes / file.size); return; }
        if (r.status >= 400 && r.status < 500 && r.status !== 422 && r.status !== 429) throw new Error("fatal " + r.status);
      } catch (e) { if (String(e.message).startsWith("fatal")) throw e; }
      if (a >= retries) throw new Error("chunk " + n + " failed after " + retries + " retries; call qaisyproUpload again to resume");
      await sleep(Math.min(30000, 1000 * 2 ** a));
    }
  }
  await Promise.all(Array.from({ length: parallel }, async () => { while (queue.length) await send(queue.shift()); }));
  return json("/complete", { sessionId: st.sessionId });
}
`;
