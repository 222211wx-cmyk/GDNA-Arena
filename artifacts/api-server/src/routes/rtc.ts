// ══════════════════════════════════════════════════════════════════════════════
//  RTC — Agora token issuance for GDNA Arena calls (authenticated only).
//
//  When AGORA_APP_CERTIFICATE is configured, issues short-lived RTC tokens
//  scoped to a single channel so only invited participants can join.
//  Without the certificate the Agora project runs in App-ID-only (testing)
//  mode and the client joins with a null token.
// ══════════════════════════════════════════════════════════════════════════════

import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import { isCallParticipant } from "../lib/signaling";

const router: IRouter = Router();

const AGORA_APP_ID = process.env.AGORA_APP_ID?.trim() || "62585b9b53c44c47baa7600ee5d74e54";
const TOKEN_TTL_SEC = 60 * 60; // 1h — longer than any realistic call setup + duration

function issueAgoraCredentials(channel: string, userId: number) {
  const certificate = process.env.AGORA_APP_CERTIFICATE?.trim();
  if (!certificate) return { appId: AGORA_APP_ID, token: null, uid: null };

  const token = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    certificate,
    channel,
    userId,
    RtcRole.PUBLISHER,
    TOKEN_TTL_SEC,
    TOKEN_TTL_SEC,
  );
  return { appId: AGORA_APP_ID, token, uid: userId };
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
  res.setHeader("Cache-Control", "no-store");
  res.json({ channel, ...issueAgoraCredentials(channel, req.session.userId) });
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

  res.json(issueAgoraCredentials(channel, req.session.userId));
});

export default router;
