import { RtcTokenBuilder, RtcRole } from "agora-token";
import { canIssueAgoraCallToken } from "../lib/agora-call-authorization";
import { getAgoraConfigStatus, readAgoraServerConfig } from "../lib/agora-config";
import { getAuthoritativeCall } from "../lib/call-signal-store";
import { canIssueGroupAgoraToken, getGroupCall } from "../lib/group-call-store";
import { currentGroupCallMember } from "../lib/group-call-eligibility";
import { callSessionBinding } from "../lib/firebase-call-push";

const TOKEN_TTL_SEC = 60 * 60;

export function issueAgoraCredentials(channel: string, userId: number) {
  const config = readAgoraServerConfig();
  const token = RtcTokenBuilder.buildTokenWithUid(
    config.appId, config.certificate, channel, userId, RtcRole.PUBLISHER, TOKEN_TTL_SEC, TOKEN_TTL_SEC,
  );
  return { appId: config.appId, token, uid: userId };
}

export { getAgoraConfigStatus };

/** Resolves the durable invitation before a token is minted; never logs token material. */
export async function authorizeAgoraJoin(channel: string, userId: number, sessionId: string, deviceId: string): Promise<boolean> {
  const direct = await getAuthoritativeCall(channel);
  if (canIssueAgoraCallToken(direct, userId, callSessionBinding(sessionId), deviceId)) return true;
  const group = await getGroupCall(channel);
  return !!group && await currentGroupCallMember(group.roomId, userId) &&
    canIssueGroupAgoraToken(group, userId, sessionId, deviceId);
}