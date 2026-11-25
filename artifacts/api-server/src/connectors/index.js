// QAISYPRO connectors (Hands). The Core never changes for a new system: add a file here and register it below.
// Contract: { name, envVars, configured(): boolean, send(ctx, opts): Promise<object> }
// ctx = { key, size, fileName, contentType, read(start?, end?): Promise<Buffer>, stream(): Promise<Readable> }
import r2 from "./r2.js";
import github from "./github.js";
import drive from "./drive.js";
import telegram from "./telegram.js";
import railway from "./railway.js";
import vercel from "./vercel.js";

export const connectors = Object.fromEntries([r2, github, drive, telegram, railway, vercel].map((c) => [c.name, c]));
export const listConnectors = () => Object.values(connectors).map((c) => ({ name: c.name, configured: c.configured(), envVars: c.envVars }));

export async function distribute(ctx, targets, opts = {}) {
  return Promise.all(targets.map(async (t) => {
    const c = connectors[t];
    if (!c) return { target: t, ok: false, error: "unknown connector" };
    if (!c.configured()) return { target: t, ok: false, error: `not configured; needs ${c.envVars.join(", ")}` };
    try { return { target: t, ...(await c.send(ctx, opts[t] ?? {})) }; }
    catch (e) { return { target: t, ok: false, error: String(e?.message ?? e).slice(0, 300) }; }
  }));
}
