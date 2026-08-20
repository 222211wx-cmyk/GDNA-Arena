import { Router, type IRouter } from "express";
import { smartFortress } from "../server.js";

const router: IRouter = Router();

function requireAuth(req: any, res: any, next: any) {
  if (!req.session?.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

router.get("/fortress/bots", requireAuth, (req, res) => {
  try {
    res.json(smartFortress.snapshot());
  } catch (err) {
    req.log.error({ err }, "Unable to load GDN-SMART FORTRESS bots");
    res.status(500).json({ error: "Unable to load the Smart Fortress." });
  }
});

router.post("/fortress/bots/:botId/challenge", requireAuth, (req, res) => {
  try {
    const bot = smartFortress.nextChallenge(req.params.botId, "manual");
    res.json({ bot, issuedAt: new Date().toISOString() });
  } catch (err) {
    req.log.warn({ err, botId: req.params.botId }, "Unable to issue fortress challenge");
    res.status(404).json({ error: "Fortress bot not found." });
  }
});

export default router;