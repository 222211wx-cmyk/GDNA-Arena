// ══════════════════════════════════════════════════════════════════════════════
//  RTC — Agora token issuance for Arena Qaisypro calls (authenticated only).
//
//  Reads AGORA_APP_ID + AGORA_APP_CERTIFICATE from process.env at request time
//  and issues short-lived tokens scoped to invited call participants.
// ══════════════════════════════════════════════════════════════════════════════

import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import { isCallParticipant } from "../lib/signaling";
import { getAgoraConfigStatus, readAgoraServerConfig } from "../lib/agora-config";

const router: IRouter = Router();

const TOKEN_TTL_SEC = 60 * 60; // 1h — longer than any realistic call setup + duration

function issueAgoraCredentials(channel: string, userId: number) {
  const config = readAgoraServerConfig();

  const token = RtcTokenBuilder.buildTokenWithUid(
    config.appId,
    config.certificate,
    channel,
    userId,
    RtcRole.PUBLISHER,
    TOKEN_TTL_SEC,
    TOKEN_TTL_SEC,
  );
  return { appId: config.appId, token, uid: userId };
}

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

router.get("/rtc/agora-token", (req, res): void => {
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

  // Participant authorization: tokens are only issued to one of the two
  // recorded participants of an active call — never for arbitrary channels.
  if (!isCallParticipant(channel, req.session.userId)) {
    res.status(403).json({ error: "Not a participant of this call" });
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
