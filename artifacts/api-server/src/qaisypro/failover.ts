// Failover: QAISYPRO_SERVERS="https://primary,https://backup1,...". Health check every 10 s (QAISYPRO_HEALTH_INTERVAL_MS to override).
// Every server shares the same R2, and upload sessions live in R2, so a transfer resumes on the backup exactly where it stopped.
type S = { url: string; healthy: boolean; checkedAt: number | null; latencyMs: number | null; consecutiveFailures: number };
let servers: S[] = []; let timer: NodeJS.Timeout | null = null;
async function check(s: S) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${s.url}/api/qaisypro/health`, { signal: AbortSignal.timeout(3000) });
    s.healthy = r.ok;
  } catch { s.healthy = false; }
  s.latencyMs = Date.now() - t0; s.checkedAt = Date.now(); s.consecutiveFailures = s.healthy ? 0 : s.consecutiveFailures + 1;
}
export const checkAll = () => Promise.all(servers.map(check));
export function startFailover() {
  if (timer) return;
  const list = (process.env.QAISYPRO_SERVERS ?? "").split(",").map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean);
  servers = list.map((url) => ({ url, healthy: true, checkedAt: null, latencyMs: null, consecutiveFailures: 0 }));
  if (servers.length < 1) return;
  void checkAll();
  timer = setInterval(() => void checkAll(), Number(process.env.QAISYPRO_HEALTH_INTERVAL_MS) || 10_000);
  timer.unref?.();
}
export const stopFailover = () => { if (timer) clearInterval(timer); timer = null; servers = []; };
export function failoverState() {
  const active = servers.find((s) => s.healthy) ?? servers[0] ?? null;
  return { primary: servers[0]?.url ?? null, active: active?.url ?? null, failedOver: Boolean(active && active !== servers[0]), servers };
}
