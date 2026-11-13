import { createHash } from "node:crypto";
import { Router, type Request, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { OPERATOR_PACKS, OPERATOR_DISCLAIMER, OPERATOR_PRIVACY, parseOperatorReferral, parseOperatorMeasurement, parsePartnerContact } from "../../../../lib/operator-partnership";
import { requireAdmin } from "../lib/finance-ledger";
import { gdnaAuth } from "./gdna";
import { cleanOperatorRetention, recordOperatorEvent, citizenScience, partnerStats, recordPartnerContact, OperatorError, operatorSessionHash } from "../lib/operator-store";

declare module "express-session" { interface SessionData { operatorAnalytics?: boolean } }
const router = Router();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const sessionHash = (req: Request) => operatorSessionHash(req.sessionID);
const writeLimit = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
const contactLimit = rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const noStore: RequestHandler = (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); };
router.use("/operators", noStore);
router.use("/partners", noStore);
const sameOrigin: RequestHandler = (req, res, next) => {
  const origin = req.get("origin");
  if (req.get("sec-fetch-site") === "cross-site") { res.status(403).json({ error: "Same-origin request required" }); return; }
  if (origin) {
    try { if (new URL(origin).host !== req.get("host")) throw new Error(); }
    catch { res.status(403).json({ error: "Same-origin request required" }); return; }
  }
  next();
};
function endpoint(fn: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    try { await cleanOperatorRetention(); await fn(req, res, next); }
    catch (e) { res.status(e instanceof OperatorError ? e.status : 503).json({ error: e instanceof OperatorError ? e.message : "Operator data storage unavailable" }); }
  };
}
async function saveSession(req: Request) {
  req.session.operatorAnalytics = true;
  await new Promise<void>((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
}
router.get("/operators/packs", (_req, res) => res.json({ packs: OPERATOR_PACKS, disclaimer: OPERATOR_DISCLAIMER, privacy: OPERATOR_PRIVACY }));
router.post("/operators/referral", sameOrigin, writeLimit, endpoint(async (req, res) => {
  let input;
  try { input = parseOperatorReferral(req.body); } catch { res.status(400).json({ error: "Expected a source and UUID eventId only" }); return; }
  await saveSession(req);
  res.json(await recordOperatorEvent(sessionHash(req), req.session.userId ?? null, input));
}));
router.post("/operators/measure", sameOrigin, writeLimit, endpoint(async (req, res) => {
  let input;
  try { input = parseOperatorMeasurement(req.body); } catch { res.status(400).json({ error: "Invalid measurement: UUID, allowed surface/outcome and bounded observedBytes required; client savings are not accepted" }); return; }
  await saveSession(req);
  res.json(await recordOperatorEvent(sessionHash(req), req.session.userId ?? null, input));
}));
router.get("/operators/science", gdnaAuth, endpoint(async (req, res) => { res.json(await citizenScience(req.session.userId!)); }));
router.get("/partners/stats", endpoint(async (_req, res) => { res.json(await partnerStats()); }));
export const operatorAdmin: RequestHandler = async (req, res, next) => {
  if (!req.session.userId) { res.status(401).json({ error: "Login required" }); return; }
  try {
    if (!(await requireAdmin(req.session.userId))) { res.status(403).json({ error: "Administrator access required" }); return; }
    next();
  } catch { res.status(503).json({ error: "Administrator verification unavailable" }); }
};
router.get("/partners/dashboard", operatorAdmin, endpoint(async (_req, res) => { res.json(await partnerStats(true)); }));
router.post("/partners/contact", sameOrigin, contactLimit, endpoint(async (req, res) => {
  let input;
  try { input = parsePartnerContact(req.body); } catch { res.status(400).json({ error: "Valid company, contactEmail, message and explicit consent required" }); return; }
  await saveSession(req);
  // Keyed hash prevents straightforward guessing of stored IP quota identifiers.
  const ipHash = hash(`operator-ip:${process.env.SESSION_SECRET ?? "development"}:${req.ip ?? "unknown"}`);
  res.status(201).json(await recordPartnerContact(sessionHash(req), ipHash, input));
}));
export default router;
