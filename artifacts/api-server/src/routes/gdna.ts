import { Router, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "@workspace/db";
import { AskGdnaBody } from "@workspace/api-zod";
import { parseAsk } from "../../../../lib/gdna-core";
import { GDNA_CORE, GDNA_AGENTS, gdnaAvailable, gdnaUsage, gdnaMemory, deleteGdnaMemory, platform, recordCapabilityVersion } from "../lib/gdna";

export const gdnaAuth: RequestHandler = async (req, res, next) => {
  const id = req.session?.userId;
  if (!id) { res.status(401).json({ error: "Login required" }); return; }
  try {
    const account = await pool.query("SELECT 1 FROM users WHERE id=$1 AND password_hash<>'DELETED'", [id]);
    if (!account.rowCount) { res.status(401).json({ error: "Account unavailable" }); return; }
    next();
  } catch { res.status(503).json({ error: "Account verification unavailable" }); }
};
export const gdnaLimited = rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: true, legacyHeaders: false });
const router = Router();
router.use("/gdna", gdnaAuth);
router.post("/gdna/ask", gdnaLimited, async (req, res) => {
  let input;
  try { input = parseAsk(AskGdnaBody.parse(req.body)); } catch { res.status(400).json({ error: "Expected query (1–4000 characters), valid section and optional boolean remember" }); return; }
  try { res.json(await GDNA_CORE.ask(input.query, { ...input, user: req.session.userId! })); }
  catch { res.status(503).json({ error: "GDNA storage or knowledge unavailable. No unverified answer was generated." }); }
});
router.get("/gdna/status", async (req, res) => {
  try {
    await recordCapabilityVersion();
    res.json({ available: gdnaAvailable(), mode: gdnaAvailable() ? "llm" : "rules", agents: GDNA_AGENTS, usage: await gdnaUsage(req.session.userId!), platform });
  } catch { res.status(503).json({ error: "GDNA status storage unavailable" }); }
});
router.get("/gdna/evolution-log", async (_req, res) => {
  try { res.json({ entries: (await pool.query('SELECT id,agent,summary,created_at AS "createdAt" FROM gdna_evolution ORDER BY created_at DESC LIMIT 30')).rows }); }
  catch { res.status(503).json({ error: "Evolution log unavailable" }); }
});
router.get("/gdna/memory", async (req, res) => {
  try { res.json({ entries: await gdnaMemory(req.session.userId!) }); }
  catch { res.status(503).json({ error: "Memory unavailable" }); }
});
router.delete("/gdna/memory", async (req, res) => {
  const id = req.body?.id;
  if (id !== undefined && (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    res.status(400).json({ error: "Invalid memory id" }); return;
  }
  try { await deleteGdnaMemory(req.session.userId!, id); res.json({ entries: await gdnaMemory(req.session.userId!) }); }
  catch { res.status(503).json({ error: "Memory deletion failed" }); }
});
export default router;