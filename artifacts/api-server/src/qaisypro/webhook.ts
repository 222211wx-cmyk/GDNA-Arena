// Signed webhook delivery with SSRF protection (https only, public addresses only, DNS pinned, no redirects).
import https from "node:https";
import http from "node:http";
import dns from "node:dns/promises";
import net from "node:net";
import { createHmac } from "node:crypto";

const allowPrivate = () => process.env.QAISYPRO_WEBHOOK_ALLOW_PRIVATE === "1"; // tests only
function isPrivate(ip: string): boolean {
  if (net.isIPv6(ip)) { const l = ip.toLowerCase(); return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || (l.startsWith("::ffff:") && isPrivate(l.slice(7))); }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
export async function checkWebhookUrl(raw: string): Promise<{ url: URL; ip: string; family: number }> {
  const url = new URL(raw);
  if (url.protocol !== "https:" && !(allowPrivate() && url.protocol === "http:")) throw new Error("webhook must be https");
  const addrs = net.isIP(url.hostname) ? [{ address: url.hostname, family: net.isIP(url.hostname) }] : await dns.lookup(url.hostname, { all: true });
  if (!addrs.length) throw new Error("webhook host does not resolve");
  if (!allowPrivate() && addrs.some((a) => isPrivate(a.address))) throw new Error("webhook host is not a public address");
  return { url, ip: addrs[0].address, family: addrs[0].family };
}
export async function sendWebhook(raw: string, secret: string, payload: object): Promise<void> {
  const body = JSON.stringify(payload);
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { url, ip, family } = await checkWebhookUrl(raw);
      await new Promise<void>((resolve, reject) => {
        const mod = url.protocol === "https:" ? https : http;
        const r = mod.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "POST", timeout: 5000,
          lookup: (_h: string, _o: any, cb: any) => cb(null, ip, family),
          headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), "x-qaisypro-signature": `sha256=${sig}`, "x-qaisypro-event": String((payload as any).event) } },
          (res) => { res.resume(); res.statusCode! >= 200 && res.statusCode! < 300 ? resolve() : reject(new Error(`status ${res.statusCode}`)); });
        r.on("timeout", () => r.destroy(new Error("timeout"))); r.on("error", reject); r.end(body);
      });
      return;
    } catch (e: any) { if (/https|public address|resolve/.test(String(e.message))) throw e; await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); }
  }
  throw new Error("webhook delivery failed after 3 attempts");
}
