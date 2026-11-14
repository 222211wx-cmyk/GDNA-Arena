import { Router, type IRouter, type Request } from "express";
import rateLimit from "express-rate-limit";
import {
  CallPushError,
  createCallPushSession,
  getAuthoritativeCallFirestore,
  isValidCallId,
  getCallPushStatus,
  listMissedCalls,
  markMissedCallsSeen,
  registerCallPushDevice,
  removeCallPushDevice,
  setCallPushFocus,
  parseFcmSendRequest,
} from "../lib/firebase-call-push";
import { broadcastToUser, declineCallForUser } from "../lib/signaling";
import { getAuthoritativeCall, getBusyCallCandidate, recoverBusyCall, heartbeatAuthoritativeCall, terminateAuthoritativeCall } from "../lib/call-signal-store";
import { registerFcmDevice, sendDerivedFcm } from "../lib/fcm";
import { registerExpoInstallation, removeExpoInstallation } from "../lib/expo-push";
import { registerNativeCallInstallation, removeNativeCallInstallation } from "../lib/native-call-push";
import { SessionRevokedError } from "../lib/session-security";

const callPushLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => req.session.userId ? `user:${req.session.userId}` : "unauthenticated",
});
const router: IRouter = Router();
router.post("/call-push/native-installations", callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    await registerNativeCallInstallation(userId, req.sessionID, req.body);
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "Not authenticated" ? 401 : message.startsWith("Invalid ") ? 400 : 503;
    res.status(status).json({ error: status === 503 && message !== "iOS VoIP calls are disabled; APNs registration is unavailable"
      ? "Native call registration unavailable" : message });
  }
});
router.delete("/call-push/native-installations", callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    await removeNativeCallInstallation(userId, req.sessionID, req.body?.installationId);
    res.json({ ok: true });
  } catch (error) {
    const invalid = error instanceof Error && error.message.startsWith("Invalid ");
    res.status(invalid ? 400 : 503).json({ error: invalid ? error.message : "Native call removal unavailable" });
  }
});
router.post("/expo-push/installations", callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    await registerExpoInstallation(userId, req.sessionID, req.body);
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof SessionRevokedError) {
      res.status(401).json({ error: "Not authenticated" }); return;
    }
    res.status(error instanceof Error && error.message.startsWith("Invalid ") ? 400 : 503)
      .json({ error: error instanceof Error && error.message.startsWith("Invalid ") ? error.message : "Expo push registration unavailable" });
  }
});

router.delete("/expo-push/installations", callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    await removeExpoInstallation(userId, req.sessionID, req.body?.installationId);
    res.json({ ok: true });
  } catch (error) {
    res.status(error instanceof Error && error.message.startsWith("Invalid ") ? 400 : 503)
      .json({ error: "Expo push removal unavailable" });
  }
});

router.get(["/expo-push/calls/:id", "/call-push/calls/:id"], callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!isValidCallId(req.params.id)) { res.status(400).json({ error: "Invalid call ID" }); return; }
  try {
    const state = await getAuthoritativeCallFirestore();
    const record = await state.collection("callInvites").doc(req.params.id).get();
    const call = record.data();
    const expires = call?.expiresAt;
    const expiresAt = expires instanceof Date ? expires.getTime() : 0;
    res.setHeader("Cache-Control", "no-store, private");
    res.json({ active: !!call && call.toId === userId && call.status === "ringing" && expiresAt > Date.now() });
  } catch {
    res.status(503).json({ error: "Call status unavailable" });
  }
});
const fcmSendLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => req.session.userId ? `user:${req.session.userId}` : "unauthenticated",
});

function authenticatedUserId(req: Request): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function errorStatus(error: unknown): number {
  if (error instanceof SessionRevokedError) return 401;
  if (!(error instanceof CallPushError)) return 500;
  if (error.message.includes("does not belong")) return 403;
  if (error.message.includes("Only the call caller") ||
    error.message.includes("not authorized") ||
    error.message.includes("unavailable for this call")) return 403;
  if (error.message.includes("not found")) return 404;
  return error.message.startsWith("Invalid ") ? 400 : 503;
}

function errorMessage(error: unknown): string {
  if (error instanceof SessionRevokedError) return error.message;
  return error instanceof CallPushError ? error.message : "Call push service failed";
}

function normalizedOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username || parsed.password || parsed.pathname !== "/" ||
      parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function requestOrigin(req: Request): string | null {
  const protocol = req.protocol;
  const host = req.get("host")?.trim();
  if ((protocol !== "http" && protocol !== "https") || !host) return null;
  return normalizedOrigin(`${protocol}://${host}`);
}

function requestOriginAllowed(req: Request): boolean {
  const origin = req.get("origin")?.trim();
  const referer = req.get("referer")?.trim();
  if (!origin && !referer) return true;

  const allowedOrigins = new Set<string>([
  ]);
  if (process.env.REPLIT_DEV_DOMAIN) allowedOrigins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  if (process.env.REPLIT_EXPO_DEV_DOMAIN) allowedOrigins.add(`https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`);
  for (const domain of (process.env.REPLIT_DOMAINS ?? "").split(",")) {
    const value = domain.trim();
    if (value) allowedOrigins.add(`https://${value}`);
  }
  if (process.env.NODE_ENV !== "production") {
    allowedOrigins.add("http://localhost:80");
    allowedOrigins.add("http://localhost");
  }

  const sameOrigin = requestOrigin(req);
  if (origin) {
    const candidate = origin === "null" ? null : normalizedOrigin(origin);
    return candidate !== null && (
      candidate === sameOrigin ||
      allowedOrigins.has(origin) ||
      allowedOrigins.has(candidate)
    );
  }
  try {
    const refererOrigin = new URL(referer!).origin;
    return refererOrigin === sameOrigin ||
      allowedOrigins.has(referer!) ||
      allowedOrigins.has(refererOrigin);
  } catch {
    return false;
  }
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
    await registerFcmDevice(userId, req.sessionID, req.body ?? {});
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

// Public compatibility alias. It intentionally shares the exact validator and
// HTTP-session binding used by the original secure registration endpoint.
router.post("/fcm/register", callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    await registerFcmDevice(userId, req.sessionID, req.body ?? {});
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

/**
 * Retry an FCM wake-up for an existing server-owned call/message. This is not
 * an FCM proxy: the body contains only a durable call ID or message/room ID;
 * the authenticated server resolves the recipient, payload, mute/block policy,
 * and session-bound device tokens.
 */
router.post("/fcm/send", fcmSendLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (!requestOriginAllowed(req)) {
    res.status(403).json({ error: "Request origin is not allowed" });
    return;
  }
  const request = parseFcmSendRequest(req.body);
  if (!request) {
    res.status(400).json({ error: "Invalid FCM send request" });
    return;
  }
  try {
    res.setHeader("Cache-Control", "no-store, private");
    res.json({ ok: true, ...(await sendDerivedFcm(userId, request)) });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.get("/call/busy-state", callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!requestOriginAllowed(req)) { res.status(403).json({ error: "Request origin is not allowed" }); return; }
  res.setHeader("Cache-Control", "no-store, private");
  try {
    res.json({ candidate: await getBusyCallCandidate(userId) });
  } catch {
    res.status(503).json({ error: "Previous call status unavailable" });
  }
});

router.post("/call/recover-busy", callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!requestOriginAllowed(req)) { res.status(403).json({ error: "Request origin is not allowed" }); return; }
  if (!req.is("application/json") || !isValidCallId(req.body?.callId) || req.body?.confirmed !== true) {
    res.status(400).json({ error: "A valid call ID and explicit confirmation are required" }); return;
  }
  res.setHeader("Cache-Control", "no-store, private");
  try {
    const completed = await recoverBusyCall(req.body.callId, userId);
    if (!completed) {
      res.status(409).json({ error: "The previous call changed or is not eligible for recovery. Check again." }); return;
    }
    const event = { type: "call-ended", by: "owner-recovery", callId: completed.callId, signalId: `${completed.callId}:terminal` };
    broadcastToUser(completed.caller.id, event);
    broadcastToUser(completed.callee.id, event);
    res.json({ ok: true });
  } catch {
    res.status(503).json({ error: "Previous call recovery unavailable" });
  }
});

router.post("/call/end", callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!requestOriginAllowed(req)) { res.status(403).json({ error: "Request origin is not allowed" }); return; }
  const callId = req.body?.callId;
  const deviceId = req.body?.deviceId;
  if (!isValidCallId(callId) || typeof deviceId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(deviceId)) {
    res.status(400).json({ error: "Invalid call ID or device ID" }); return;
  }
  try {
    const record = await getAuthoritativeCall(callId);
    if (!record) { res.status(404).json({ error: "Call not found" }); return; }
    // Caller ownership and selected callee ownership are checked transactionally.
    // A ringing callee can decline from any authenticated device.
    const terminal = record.status === "ringing" && record.callee.id === userId
      ? await declineCallForUser(callId, userId)
      : await terminateAuthoritativeCall(callId, userId, req.sessionID, deviceId, "ended");
    if (record.caller.id !== userId && record.callee.id !== userId) {
      res.status(403).json({ error: "Not a call participant" }); return;
    }
    if (terminal === null) {
      const latest = await getAuthoritativeCall(callId);
      if (!latest?.endedAt) { res.status(403).json({ error: "Call session does not own this call" }); return; }
    }
    res.json({ ok: true, callId, changed: terminal !== null && !("changed" in terminal) ? true : terminal && "changed" in terminal ? terminal.changed : false });
  } catch (error) { res.status(errorStatus(error)).json({ error: errorMessage(error) }); }
});

router.post("/call/heartbeat", callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!requestOriginAllowed(req)) { res.status(403).json({ error: "Request origin is not allowed" }); return; }
  const { callId, deviceId } = req.body ?? {};
  if (!isValidCallId(callId) || typeof deviceId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(deviceId)) {
    res.status(400).json({ error: "Invalid call ID or device ID" }); return;
  }
  try {
    const renewed = await heartbeatAuthoritativeCall(callId, userId, req.sessionID, deviceId, req.body?.background === true);
    if (!renewed) { res.status(403).json({ error: "Call session cannot renew this call" }); return; }
    res.json({ ok: true });
  } catch (error) { res.status(errorStatus(error)).json({ error: errorMessage(error) }); }
});

router.post("/call/decline", callPushLimiter, async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (!requestOriginAllowed(req)) {
    res.status(403).json({ error: "Request origin is not allowed" });
    return;
  }
  const callId = typeof req.query.id === "string" ? req.query.id.trim() : "";
  if (!isValidCallId(callId)) {
    res.status(400).json({ error: "Invalid call ID" });
    return;
  }
  try {
    const result = await declineCallForUser(callId, userId);
    if (result.outcome === "not-callee") {
      res.status(403).json({ error: "Only the invited callee can decline this call" });
      return;
    }
    if (result.outcome === "not-found") {
      res.status(404).json({ error: "Call invitation not found" });
      return;
    }
    // `changed: false` is intentionally still successful for a terminal
    // invitation: retries are idempotent and never recreate/resurrect it.
    res.json({
      ok: true,
      callId,
      status: result.status ?? "finished",
      changed: result.changed,
    });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

export default router;
