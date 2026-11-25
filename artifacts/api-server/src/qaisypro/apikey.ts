// API keys for machine clients (other systems, GDN-SMART jobs). QAISYPRO_API_KEYS="name1:secret1,name2:secret2".
import { createHash, timingSafeEqual } from "node:crypto";
const sha = (s: string) => createHash("sha256").update(s).digest();
function table() {
  return (process.env.QAISYPRO_API_KEYS ?? "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
    const i = x.indexOf(":"); return i > 0 ? { name: x.slice(0, i), secret: x.slice(i + 1) } : { name: "default", secret: x };
  }).filter((k) => k.secret.length >= 16);
}
export const apiKeysEnabled = () => table().length > 0;
export function apiKeyFrom(req: any): { name: string; secret: string } | null {
  const h = String(req.get("x-api-key") ?? (/^Bearer (.+)$/i.exec(req.get("authorization") ?? "")?.[1] ?? ""));
  if (!h) return null;
  const given = sha(h); let found: { name: string; secret: string } | null = null;
  for (const k of table()) if (timingSafeEqual(given, sha(k.secret))) found = k; // no early exit
  return found;
}
