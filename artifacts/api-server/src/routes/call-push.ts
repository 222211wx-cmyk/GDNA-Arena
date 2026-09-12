import { Router, type IRouter, type Request } from "express";
import rateLimit from "express-rate-limit";
import {
  CallPushError,
  createCallPushSession,
  getCallPushStatus,
  listMissedCalls,
  markMissedCallsSeen,
  registerCallPushDevice,
  removeCallPushDevice,
  setCallPushFocus,
} from "../lib/firebase-call-push";

const router: IRouter = Router();
const callPushLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => req.session.userId ? `user:${req.session.userId}` : "unauthenticated",
});

function authenticatedUserId(req: Request): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function errorStatus(error: unknown): number {
  if (!(error instanceof CallPushError)) return 500;
  if (error.message.includes("does not belong")) return 403;
  return error.message.startsWith("Invalid ") ? 400 : 503;
}

function errorMessage(error: unknown): string {
  return error instanceof CallPushError ? error.message : "Call push service failed";
}

router.get("/call-push/config", async (_req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store, private");
  res.json(await getCallPushStatus());
});

router.post("/call-push/session", callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    res.setHeader("Cache-Control", "no-store, private");
    const expires = req.session.cookie.expires;
    res.json(await createCallPushSession(
      userId,
      req.sessionID,
      expires instanceof Date ? expires : undefined,
    ));
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.post("/call-push/devices", callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    await registerCallPushDevice(userId, req.sessionID, req.body ?? {});
    res.json({ ok: true });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.delete("/call-push/devices", callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    await removeCallPushDevice(userId, req.sessionID, req.body?.installationId);
    res.json({ ok: true });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.post("/call-push/focus", callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    await setCallPushFocus(userId, req.sessionID, req.body?.installationId, req.body?.focused);
    res.json({ ok: true });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.get("/call-push/missed", callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    res.setHeader("Cache-Control", "no-store, private");
    res.json(await listMissedCalls(userId));
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.post("/call-push/missed/seen", callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    await markMissedCallsSeen(userId, req.body?.ids);
    res.json({ ok: true });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

export default router;