// Browser client source (served as text at GET /api/qaisypro/client.js).
export const CLIENT_JS = `
// QAISYPRO resumable uploader: slice -> fingerprint -> send 8 in parallel -> retry 5x -> resume forever.
// bases: [primary, backup, ...] — on a network error or 502/503 the client switches server and keeps going
// (all servers share the same R2, so the session resumes exactly where it stopped).
export async function qaisyproUpload(file, { onProgress, base = "/api/qaisypro", bases, parallel = 8, retries = 5 } = {}) {
  const list = bases?.length ? bases : [base]; let cur = 0;
  const f = async (path, init) => {
    let last;
    for (let i = 0; i < list.length; i++) {
      const b = list[(cur + i) % list.length];
      try { const r = await fetch(b + path, { credentials: "include", ...init }); if (r.status !== 502 && r.status !== 503 || list.length === 1) { cur = (cur + i) % list.length; return r; } last = new Error("HTTP " + r.status); }
      catch (e) { last = e; }
    }
    throw last;
  };
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const json = async (p, body) => { const r = await f(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status); return r.json(); };
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
        const r = await f("/chunk?sessionId=" + st.sessionId + "&index=" + n, { method: "PUT", headers: { "x-chunk-sha256": sha }, body: buf });
        if (r.ok) { bytes += buf.byteLength; onProgress?.(bytes / file.size); return; }
        if (r.status >= 400 && r.status < 500 && r.status !== 422 && r.status !== 429) throw new Error("fatal " + r.status);
      } catch (e) { if (String(e.message).startsWith("fatal")) throw e; }
      if (a >= retries) throw new Error("chunk " + n + " failed after " + retries + " retries; call qaisyproUpload again to resume");
      await sleep(Math.min(30000, 1000 * 2 ** a));
    }
  }
  await Promise.all(Array.from({ length: parallel }, async () => { while (queue.length) await send(queue.shift()); }));
  const result = await json("/complete", { sessionId: st.sessionId });
  return { ...result, sessionId: st.sessionId };
}
// One click: send the uploaded file (or a file extracted from it, via path) to every target at once. Operator only.
export async function qaisyproDistribute(sessionId, targets, { base = "/api/qaisypro", path } = {}) {
  const r = await fetch(base + "/distribute", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, targets, path }) });
  return r.json();
}
`;
