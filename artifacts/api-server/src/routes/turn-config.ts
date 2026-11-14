import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { TurnConfigurationError } from "../lib/turn-config";
import { getRtcIceServers, getTurnCredentials } from "../lib/turn";

const router: IRouter = Router();
const iceConfigLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => req.session.userId ? `user:${req.session.userId}` : "unauthenticated",
});

router.get(["/rtc/ice-servers", "/rtc/turn-ice-servers", "/turn/creds"], iceConfigLimiter, (req, res): void => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  res.setHeader("Cache-Control", "no-store, private");
  try {
    const diagnostic = req.path === "/rtc/turn-ice-servers" || req.path === "/turn/creds";
    const config = diagnostic
      ? getTurnCredentials(req.session.userId, req.sessionID)
      : getRtcIceServers(req.session.userId, req.sessionID);
    if (diagnostic) req.log.info({ turnUrls: process.env.TURN_URLS?.split(",").map(url => url.trim()) }, "TURN relay diagnostic configuration issued");
    res.json(config);
  } catch (error) {
    if (error instanceof TurnConfigurationError) {
      req.log.error({ error: error.message }, "WebRTC provider is opted in but TURN is not ready");
      res.status(503).json({
        error: "WebRTC calling is selected but the external TURN service is not configured",
      });
      return;
    }
    throw error;
  }
});

export default router;
