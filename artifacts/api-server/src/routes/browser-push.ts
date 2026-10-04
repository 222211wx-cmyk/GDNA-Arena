import { Router, type IRouter, type Request } from "express";
import rateLimit from "express-rate-limit";
import { SessionRevokedError } from "../lib/session-security";
import {
  BrowserPushError,
  BrowserPushRenewalConflictError,
  getBrowserPushConfig,
  parseBrowserPushRegistration,
  parseBrowserPushRenewal,
  parseBrowserPushRemoval,
  registerBrowserPushSubscription,
  renewBrowserPushSubscription,
  removeBrowserPushSubscription,
} from "../lib/browser-push";

const router: IRouter = Router();
const mutationLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => req.session.userId ? `user:${req.session.userId}` : "unauthenticated",
});

function currentUserId(req: Request): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function allowedBrowserOrigin(req: Request): boolean {
  const source = req.get("origin") ?? req.get("referer");
  if (!source) return process.env.NODE_ENV !== "production";
  let origin: string;
  try {
    origin = new URL(source).origin;
  } catch {
    return false;
  }
  const allowed = new Set<string>();
  const host = req.get("host");
  if (host) allowed.add(`${req.protocol}://${host}`);
  if (process.env.REPLIT_DEV_DOMAIN) allowed.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  if (process.env.REPLIT_EXPO_DEV_DOMAIN) allowed.add(`https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`);
  for (const domain of (process.env.REPLIT_DOMAINS ?? "").split(",")) {
    if (domain.trim()) allowed.add(`https://${domain.trim()}`);
  }
  if (process.env.NODE_ENV !== "production") {
    allowed.add("http://localhost");
    allowed.add("http://localhost:80");
  }
  return allowed.has(origin);
}

router.get("/browser-push/config", async (req, res): Promise<void> => {
  if (!currentUserId(req)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  try {
    res.json(await getBrowserPushConfig());
  } catch (error) {
    res.status(503).json({
      enabled: false,
      error: error instanceof BrowserPushError ? error.message : "Browser push is unavailable",
    });
  }
});

router.post("/browser-push/subscriptions", mutationLimiter, async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!allowedBrowserOrigin(req)) {
    res.status(403).json({ error: "Cross-origin request rejected" });
    return;
  }
  const input = parseBrowserPushRegistration(req.body);
  if (!input) {
    res.status(400).json({ error: "Invalid browser push subscription" });
    return;
  }
  try {
    await registerBrowserPushSubscription({
      userId,
      sessionId: req.sessionID,
      installationId: input.installationId,
      subscription: input.subscription,
    });
    res.status(204).end();
  } catch (error) {
    if (error instanceof SessionRevokedError) {
      res.status(401).json({ error: "Not authenticated" }); return;
    }
    const conflict = error instanceof BrowserPushError && error.message.includes("another session");
    res.status(conflict ? 409 : 503).json({
      error: error instanceof BrowserPushError ? error.message : "Browser push registration failed",
    });
  }
});

router.post("/browser-push/subscriptions/renew", mutationLimiter, async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!allowedBrowserOrigin(req)) {
    res.status(403).json({ error: "Cross-origin request rejected" });
    return;
  }
  const input = parseBrowserPushRenewal(req.body);
  if (!input) {
    res.status(400).json({ error: "Invalid browser push renewal" });
    return;
  }
  try {
    await renewBrowserPushSubscription({
      userId,
      sessionId: req.sessionID,
      ...input,
    });
    res.status(204).end();
  } catch (error) {
    if (error instanceof SessionRevokedError) {
      res.status(401).json({ error: "Not authenticated" }); return;
    }
    res.status(error instanceof BrowserPushRenewalConflictError ? 409 : 503).json({
      error: error instanceof BrowserPushError ? error.message : "Browser push renewal failed",
    });
  }
});

router.delete("/browser-push/subscriptions", mutationLimiter, async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!allowedBrowserOrigin(req)) {
    res.status(403).json({ error: "Cross-origin request rejected" });
    return;
  }
  const input = parseBrowserPushRemoval(req.body);
  if (!input) {
    res.status(400).json({ error: "Invalid installation ID" });
    return;
  }
  try {
    const removed = await removeBrowserPushSubscription({
      userId,
      sessionId: req.sessionID,
      installationId: input.installationId,
    });
    res.status(removed ? 204 : 404);
    if (removed) res.end();
    else res.json({ error: "Subscription not found for this session" });
  } catch {
    res.status(503).json({ error: "Browser push removal failed" });
  }
});

export default router;