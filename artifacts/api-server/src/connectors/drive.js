// Connector: Google Drive. Resumable upload, 8 MiB ranges read straight from R2 (no size ceiling, no full copy in RAM).
const STEP = 8 * 1024 * 1024; // multiple of 256 KiB, as Drive requires
const TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const UPLOAD_URL = () => process.env.GOOGLE_DRIVE_UPLOAD_URL || "https://www.googleapis.com/upload/drive/v3/files";

async function accessToken() {
  if (process.env.GOOGLE_DRIVE_ACCESS_TOKEN) return process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
  const r = await fetch(TOKEN_URL(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: process.env.GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token" }) });
  const j = await r.json(); if (!j.access_token) throw new Error(`Google token refresh failed (${r.status})`); return j.access_token;
}
export default {
  name: "drive",
  envVars: ["GOOGLE_DRIVE_ACCESS_TOKEN or (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)", "GOOGLE_DRIVE_FOLDER_ID (optional)"],
  configured: () => Boolean(process.env.GOOGLE_DRIVE_ACCESS_TOKEN || (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN)),
  async send(ctx) {
    const token = await accessToken();
    const meta = { name: ctx.fileName, ...(process.env.GOOGLE_DRIVE_FOLDER_ID ? { parents: [process.env.GOOGLE_DRIVE_FOLDER_ID] } : {}) };
    const init = await fetch(`${UPLOAD_URL()}?uploadType=resumable`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "x-upload-content-length": String(ctx.size), "x-upload-content-type": ctx.contentType || "application/octet-stream" }, body: JSON.stringify(meta) });
    const loc = init.headers.get("location"); if (!loc) throw new Error(`Drive init failed (${init.status})`);
    if (ctx.size === 0) { const r = await fetch(loc, { method: "PUT", headers: { "content-length": "0" } }); const j = await r.json(); return { ok: true, fileId: j.id }; }
    for (let a = 0; a < ctx.size; a += STEP) {
      const b = Math.min(ctx.size, a + STEP) - 1; const body = await ctx.read(a, b);
      for (let t = 0; ; t++) {
        const r = await fetch(loc, { method: "PUT", headers: { "content-range": `bytes ${a}-${b}/${ctx.size}`, "content-length": String(body.length) }, body });
        if (r.status === 308 || r.status === 200 || r.status === 201) { if (b + 1 === ctx.size) { const j = await r.json().catch(() => ({})); return { ok: true, fileId: j.id }; } break; }
        if (t >= 3 || r.status < 500) throw new Error(`Drive upload ${r.status}`);
        await new Promise((x) => setTimeout(x, 500 * 2 ** t));
      }
    }
    throw new Error("Drive upload ended without a final response");
  },
};
