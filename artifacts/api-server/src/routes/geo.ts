/**
 * GEO-COMPLIANCE ROUTER
 * Detects user country from IP → returns restriction level.
 * BLOCKED  = platform forbidden in this jurisdiction
 * RESTRICTED = access with mandatory warnings + age gate
 * ALLOWED  = full access
 */
import { Router } from "express";

const router = Router();

// ── Restriction matrix ────────────────────────────────────────
// BLOCKED: sanctioned countries + complete online-gaming bans
const BLOCKED = new Set([
  "KP", // North Korea — sanctions + total internet control
  "IR", // Iran — OFAC sanctions + strict content laws
  "CU", // Cuba — OFAC sanctions
  "SY", // Syria — OFAC sanctions
  "SD", // Sudan — OFAC sanctions
  "MM", // Myanmar — military junta internet blocks
  "AF", // Afghanistan — Taliban complete ban on gaming
]);

// RESTRICTED: regulated gaming markets — access allowed with
// mandatory disclaimers, age gate, and legal warnings
const RESTRICTED = new Set([
  "SA", "AE", "QA", "KW", "BH", "OM", // Gulf — gambling prohibited, virtual coins regulated
  "ID", // Indonesia — online gaming regulated
  "PK", // Pakistan — strict content laws
  "BD", // Bangladesh — online gaming restricted
  "TR", // Turkey — BTK content filtering
  "CN", // China — Great Firewall + gaming age limits
  "RU", // Russia — foreign platform restrictions
]);

type Restriction = "allowed" | "restricted" | "blocked";

interface GeoResult {
  ip: string;
  countryCode: string;
  country: string;
  restriction: Restriction;
  message: string;
  laws: string[];
}

function getRestriction(code: string): { restriction: Restriction; message: string; laws: string[] } {
  const uc = code.toUpperCase();
  if (BLOCKED.has(uc)) {
    return {
      restriction: "blocked",
      message: "Arena Qaisypro is not available in your country due to international regulations or sanctions.",
      laws: ["OFAC Sanctions", "Local Digital Content Law"],
    };
  }
  if (RESTRICTED.has(uc)) {
    return {
      restriction: "restricted",
      message: "Arena Qaisypro is available in your country with regulatory restrictions. Virtual coins have no monetary value.",
      laws: ["Local Gaming Regulations", "Virtual Currency Law"],
    };
  }
  return {
    restriction: "allowed",
    message: "Arena Qaisypro is fully available in your country.",
    laws: [],
  };
}

// ── GET /api/geo/detect ───────────────────────────────────────
router.get("/detect", async (req, res): Promise<void> => {
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    (req.headers["cf-connecting-ip"] as string | undefined) ||
    req.socket.remoteAddress ||
    "127.0.0.1";

  // Localhost / dev → return INT/allowed
  if (ip === "127.0.0.1" || ip === "::1" || ip?.startsWith("10.") || ip?.startsWith("172.") || ip?.startsWith("192.168.")) {
    res.json({
      ip,
      countryCode: "INT",
      country: "International",
      restriction: "allowed",
      message: "Development environment — full access.",
      laws: [],
    } as GeoResult);
    return;
  }

  try {
    // ip-api.com free tier — 45 req/min, no key needed
    const response = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode`,
      { signal: AbortSignal.timeout(3000) }
    );
    const data = await response.json() as { status: string; country: string; countryCode: string; message?: string };

    if (data.status !== "success") {
      res.json({ ip, countryCode: "INT", country: "Unknown", restriction: "allowed", message: "Country detection unavailable — full access granted.", laws: [] } as GeoResult);
      return;
    }

    const { restriction, message, laws } = getRestriction(data.countryCode);

    res.json({
      ip: ip.slice(0, 8) + "***", // partial IP for privacy
      countryCode: data.countryCode,
      country: data.country,
      restriction,
      message,
      laws,
    } as GeoResult);
  } catch {
    // Fallback — if detection fails, allow access
    res.json({ ip, countryCode: "INT", country: "Unknown", restriction: "allowed", message: "Detection unavailable — access granted.", laws: [] } as GeoResult);
  }
});

// ── GET /api/geo/matrix — full restriction matrix ─────────────
router.get("/matrix", (_req, res): Promise<void> => {
  const blocked = Array.from(BLOCKED);
  const restricted = Array.from(RESTRICTED);
  res.json({
    blocked,
    restricted,
    blocked_count: blocked.length,
    restricted_count: restricted.length,
    total_monitored: blocked.length + restricted.length,
  });
  return Promise.resolve();
});

export default router;
