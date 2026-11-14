// ══════════════════════════════════════════════════════════════════════════════
//  RTC — Agora token issuance for Arena Qaisypro calls (authenticated only).
//
//  Reads AGORA_APP_ID + AGORA_APP_CERTIFICATE from process.env at request time
//  and issues short-lived tokens scoped to invited call participants.
// ══════════════════════════════════════════════════════════════════════════════

import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { authorizeAgoraJoin, getAgoraConfigStatus, issueAgoraCredentials } from "../lib/agora";

const router: IRouter = Router();

// The preflight joins an isolated Agora channel and measures Agora's own
// last-mile quality signal. It intentionally does not make any direct/relay
// claim because call media is managed by Agora rather than browser ICE.
router.get("/rtc/preflight-token", (req, res): void => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const channel = `preflight_${randomUUID().replace(/-/g, "")}`;
  try {
    const credentials = issueAgoraCredentials(channel, req.session.userId);
    res.setHeader("Cache-Control", "no-store");
    res.json({ channel, ...credentials });
  } catch (error) {
    req.log.warn(getAgoraConfigStatus(), "Agora token request arrived before configuration was ready");
    res.setHeader("Retry-After", "2");
    res.status(503).json({ error: "Secure call service is starting; retry shortly" });
  }
});

router.get(["/rtc/agora-token", "/agora/token"], async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const channel = typeof req.query.channel === "string" ? req.query.channel.trim() : "";
  if (!channel || channel.length > 64 || !/^[A-Za-z0-9_-]+$/.test(channel)) {
    res.status(400).json({ error: "Invalid channel" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");

  const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId : "";
  if (!deviceId || deviceId.length > 128) {
    res.status(400).json({ error: "Valid signaling deviceId required" });
    return;
  }

  // Binding tokens to the winning session/device prevents another logged-in
  // device from joining a call before Answer or after it answered elsewhere.
  try {
    if (!await authorizeAgoraJoin(channel, req.session.userId, req.sessionID, deviceId)) {
      res.status(403).json({ error: "This session/device is not authorized to join the call" });
      return;
    }
  } catch {
    res.status(503).json({ error: "Call signaling is unavailable", code: "CALL_SIGNALING_UNAVAILABLE" });
    return;
  }

  try {
    const credentials = issueAgoraCredentials(channel, req.session.userId);
    res.json(credentials);
  } catch (error) {
    req.log.warn(getAgoraConfigStatus(), "Agora token request arrived before configuration was ready");
    res.setHeader("Retry-After", "2");
    res.status(503).json({ error: "Secure call service is starting; retry shortly" });
  }
});

export default router;
