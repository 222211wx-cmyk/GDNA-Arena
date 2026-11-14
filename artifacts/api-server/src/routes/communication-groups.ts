import { Router, type IRouter, type Request } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../lib/db";
import {
  answerGroupCall, createGroupCall, getGroupCall, rejectOrLeaveGroupCall,
  isStoredGroupCallParticipant, type GroupCallRecord, type GroupParticipant,
} from "../lib/group-call-store";
import { callSessionBinding, sendAuthoritativeGroupCallPush } from "../lib/push-disabled";
import { currentGroupCallMember } from "../lib/group-call-eligibility";

const router: IRouter = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => req.session.userId ? `user:${req.session.userId}` : "unauthenticated" });
const devicePattern = /^[A-Za-z0-9_-]{16,128}$/;

// The public communication facade accepts numeric user IDs. Resolve them
// server-side instead of accidentally treating an ID as a username.
router.get("/communication/users/:id", limiter, async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const targetId = Number(req.params.id);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }
  const result = await pool.query<{ id: number; username: string }>(
    "SELECT id, username FROM users WHERE id=$1 LIMIT 1", [targetId],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Citizen not found" });
    return;
  }
  res.json({ userId: result.rows[0].id, username: result.rows[0].username });
});

function userId(req: Request): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}
function validRoomId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
function validDevice(value: unknown): value is string {
  return typeof value === "string" && devicePattern.test(value);
}
function validEnvelope(value: unknown): value is { devices: Record<string, string>; fingerprints: Record<string, string> } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const devices = (value as Record<string, unknown>).devices;
  const fingerprints = (value as Record<string, unknown>).fingerprints;
  return !!devices && typeof devices === "object" && !Array.isArray(devices) &&
    !!fingerprints && typeof fingerprints === "object" && !Array.isArray(fingerprints) &&
    Object.keys(devices).length > 0 && JSON.stringify(value).length <= 256_000 &&
    Object.keys(devices).length === Object.keys(fingerprints).length &&
    Object.keys(devices).every(id => Object.hasOwn(fingerprints, id) && typeof (fingerprints as Record<string, unknown>)[id] === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test((fingerprints as Record<string, string>)[id])) &&
    Object.entries(devices).every(([id, key]) => devicePattern.test(id) && typeof key === "string" && key.length >= 32 && key.length <= 16_384);
}
async function ownedE2eeDevice(id: number, deviceId: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM dm_user_e2ee_keys WHERE user_id=$1 AND device_id=$2 LIMIT 1`, [id, deviceId]);
  return result.rows.length > 0;
}
async function roster(roomId: number, creatorId: number): Promise<{ participants: GroupParticipant[]; pushRecipients: number[]; deviceIds: string[]; fingerprints: Record<string, string> }> {
  const members = await pool.query<{ user_id: number; username: string; muted: boolean; blocked: boolean }>(
    `SELECT member.user_id, member.username, COALESCE(member.muted, false) AS muted,
       EXISTS(SELECT 1 FROM citizen_blocks block WHERE
         (block.blocker_id=$2 AND block.blocked_id=member.user_id) OR
         (block.blocker_id=member.user_id AND block.blocked_id=$2)) AS blocked
       FROM dm_room_members member WHERE member.room_id=$1 ORDER BY member.user_id`, [roomId, creatorId]);
  const eligible = members.rows.filter(member => member.user_id === creatorId || (!member.muted && !member.blocked));
  const ids = eligible.map(member => member.user_id);
  const keys = ids.length ? await pool.query<{ device_id: string; fingerprint: string }>(
    `SELECT device_id, fingerprint FROM dm_user_e2ee_keys WHERE user_id = ANY($1::int[])`, [ids]) : { rows: [] };
  return {
    participants: eligible.map(member => ({ userId: member.user_id, username: member.username,
      status: member.user_id === creatorId ? "accepted" : "invited" })),
    pushRecipients: eligible.filter(member => member.user_id !== creatorId).map(member => member.user_id),
    deviceIds: keys.rows.map(row => row.device_id),
    fingerprints: Object.fromEntries(keys.rows.map(row => [row.device_id, row.fingerprint])),
  };
}
async function present(call: GroupCallRecord, id: number) {
  const ownDevices = await pool.query<{ device_id: string; fingerprint: string }>(`SELECT device_id, fingerprint FROM dm_user_e2ee_keys WHERE user_id=$1`, [id]);
  const allowed = new Set(ownDevices.rows.filter(row => !call.e2e.fingerprints ||
    call.e2e.fingerprints[row.device_id] === row.fingerprint).map(row => row.device_id));
  return {
    callId: call.callId, channel: call.channel, roomId: call.roomId, creatorId: call.creatorId,
    type: call.type === "voice" ? "audio" : "video", status: call.status, transport: call.transport, createdAt: call.createdAt.toISOString(),
    endedAt: call.endedAt?.toISOString(), participants: call.participants,
    e2e: { devices: Object.fromEntries(Object.entries(call.e2e.devices).filter(([deviceId]) => allowed.has(deviceId))),
      fingerprints: call.e2e.fingerprints ? Object.fromEntries(Object.entries(call.e2e.fingerprints).filter(([deviceId]) => allowed.has(deviceId))) : undefined },
  };
}

router.post("/communication/groups", limiter, async (req, res): Promise<void> => {
  const caller = userId(req);
  const body = req.body ?? {};
  if (!caller) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!validRoomId(body.roomId) || (body.type !== "video" && body.type !== "voice" && body.type !== "audio") ||
      !validDevice(body.deviceId) || !validEnvelope(body.e2e)) {
    res.status(400).json({ error: "Invalid group call request" }); return;
  }
  try {
    if (!await currentGroupCallMember(body.roomId, caller)) { res.status(403).json({ error: "Current group membership is required" }); return; }
    if (!await ownedE2eeDevice(caller, body.deviceId)) { res.status(403).json({ error: "Registered E2EE device is required" }); return; }
    const group = await roster(body.roomId, caller);
    if (group.participants.length < 2 || !group.deviceIds.includes(body.deviceId) ||
      group.deviceIds.length !== Object.keys(body.e2e.devices).length ||
      group.deviceIds.some(deviceId => !Object.hasOwn(body.e2e.devices, deviceId) ||
        body.e2e.fingerprints[deviceId] !== group.fingerprints[deviceId])) {
      res.status(409).json({ error: "Current member E2EE device envelope is incomplete" }); return;
    }
    const participants = group.participants.map(participant => participant.userId === caller
      ? { ...participant, deviceId: body.deviceId, sessionTag: callSessionBinding(req.sessionID) }
      : participant);
    const call = await createGroupCall({ roomId: body.roomId, creatorId: caller, type: body.type === "audio" ? "voice" : body.type, e2e: body.e2e, participants });
    void Promise.all(group.pushRecipients.map(recipientId => sendAuthoritativeGroupCallPush({
      callId: call.callId, roomId: call.roomId,
      callerName: participants.find(participant => participant.userId === caller)!.username,
      recipientId, video: call.type === "video",
    })));
    res.status(201).json({ call: await present(call, caller) });
  } catch {
    res.status(503).json({ error: "Authoritative group call service is unavailable", code: "CALL_SIGNALING_UNAVAILABLE" });
  }
});

router.get("/communication/groups/incoming", limiter, async (req, res): Promise<void> => {
  const member = userId(req);
  if (!member) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    console.log("push disabled");
    res.setHeader("Cache-Control", "no-store, private");
    res.json({ calls: [] });
  } catch {
    res.status(503).json({ error: "Authoritative group call service is unavailable", code: "CALL_SIGNALING_UNAVAILABLE" });
  }
});

router.get("/communication/groups/:callId", limiter, async (req, res): Promise<void> => {
  const member = userId(req);
  if (!member) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const call = await getGroupCall(String(req.params.callId));
    if (!call) { res.status(404).json({ error: "Group call not found" }); return; }
    if (!isStoredGroupCallParticipant(call, member) || !await currentGroupCallMember(call.roomId, member)) {
      res.status(403).json({ error: "Current group call membership is required" }); return;
    }
    res.setHeader("Cache-Control", "no-store, private");
    res.json({ call: await present(call, member) });
  } catch { res.status(503).json({ error: "Authoritative group call service is unavailable", code: "CALL_SIGNALING_UNAVAILABLE" }); }
});

async function transition(req: Request, res: any, action: "answer" | "end" | "reject") {
  const member = userId(req); const deviceId = req.body?.deviceId;
  if (!member) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!validDevice(deviceId)) { res.status(400).json({ error: "Valid deviceId required" }); return; }
  try {
    const call = await getGroupCall(String(req.params.callId));
    if (!call) { res.status(404).json({ error: "Group call not found" }); return; }
    if (!isStoredGroupCallParticipant(call, member) || !await currentGroupCallMember(call.roomId, member) || !await ownedE2eeDevice(member, deviceId)) {
      res.status(403).json({ error: "Current group membership and E2EE device are required" }); return;
    }
    if (action === "answer" && call.e2e.fingerprints) {
      const registered = await pool.query<{ fingerprint: string }>(
        `SELECT fingerprint FROM dm_user_e2ee_keys WHERE user_id=$1 AND device_id=$2`, [member, deviceId]);
      if (!Object.hasOwn(call.e2e.devices, deviceId) || registered.rows[0]?.fingerprint !== call.e2e.fingerprints[deviceId]) {
        res.status(409).json({ error: "Secure device keys changed; start a new group call" }); return;
      }
    }
    const next = action === "answer" ? await answerGroupCall(call.callId, member, req.sessionID, deviceId) :
      await rejectOrLeaveGroupCall(call.callId, member, req.sessionID, deviceId, action === "reject");
    if (!next) { res.status(409).json({ error: "Group call state no longer permits this action" }); return; }
    res.json({ call: await present(next, member) });
  } catch { res.status(503).json({ error: "Authoritative group call service is unavailable", code: "CALL_SIGNALING_UNAVAILABLE" }); }
}
router.post("/communication/groups/:callId/answer", limiter, (req, res) => void transition(req, res, "answer"));
router.post("/communication/groups/:callId/end", limiter, (req, res) => void transition(req, res, "end"));
router.post("/communication/groups/:callId/reject", limiter, (req, res) => void transition(req, res, "reject"));

export default router;
