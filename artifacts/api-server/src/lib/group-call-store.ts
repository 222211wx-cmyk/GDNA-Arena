import { randomUUID } from "node:crypto";
import { CallPushError, callSessionBinding, getCallStateDb } from "./call-state-db";

function isValidCallId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export type GroupParticipantStatus = "accepted" | "invited" | "rejected" | "left";
export interface GroupParticipant {
  userId: number;
  username: string;
  status: GroupParticipantStatus;
  deviceId?: string;
  sessionTag?: string;
}
export interface GroupCallRecord {
  callId: string;
  channel: string;
  roomId: number;
  creatorId: number;
  type: "video" | "voice";
  status: "active" | "ended";
  transport: { provider: "agora"; version: 1 };
  e2e: { devices: Record<string, string>; fingerprints?: Record<string, string> };
  participants: GroupParticipant[];
  createdAt: Date;
  endedAt?: Date;
}

function ref(db: ReturnType<typeof getCallStateDb>, callId: string) {
  return db.collection("groupCallInvites").doc(callId);
}
function date(value: unknown): Date {
  return value instanceof Date ? value :
    value && typeof (value as { toDate?: unknown }).toDate === "function"
      ? (value as { toDate(): Date }).toDate() : new Date(0);
}
function canonical(callId: string, value: Record<string, unknown>): GroupCallRecord | null {
  if (typeof value.channel !== "string" || !isValidCallId(value.channel) ||
      !Number.isSafeInteger(value.roomId) || !Number.isSafeInteger(value.creatorId) ||
      (value.type !== "video" && value.type !== "voice") ||
      (value.status !== "active" && value.status !== "ended") ||
      !Array.isArray(value.participants) || !value.e2e || typeof value.e2e !== "object") return null;
  const participants = value.participants.flatMap(participant => {
    if (!participant || typeof participant !== "object") return [];
    const item = participant as Record<string, unknown>;
    if (!Number.isSafeInteger(item.userId) || typeof item.username !== "string" ||
        (item.status !== "accepted" && item.status !== "invited" && item.status !== "rejected" && item.status !== "left")) return [];
    return [{ userId: item.userId as number, username: item.username as string, status: item.status as GroupParticipantStatus,
      deviceId: typeof item.deviceId === "string" ? item.deviceId : undefined,
      sessionTag: typeof item.sessionTag === "string" ? item.sessionTag : undefined }];
  });
  if (!participants.length || participants.length !== value.participants.length) return null;
  const devices = (value.e2e as Record<string, unknown>).devices;
  if (!devices || typeof devices !== "object" || Array.isArray(devices)) return null;
  return {
    callId, channel: value.channel as string, roomId: value.roomId as number, creatorId: value.creatorId as number,
    type: value.type, status: value.status, transport: { provider: "agora", version: 1 },
    e2e: { devices: devices as Record<string, string>,
      fingerprints: (value.e2e as Record<string, unknown>).fingerprints as Record<string, string> | undefined }, participants,
    createdAt: date(value.createdAt), endedAt: value.endedAt ? date(value.endedAt) : undefined,
  };
}

export async function createGroupCall(input: Omit<GroupCallRecord, "callId" | "channel" | "status" | "createdAt" | "transport">): Promise<GroupCallRecord> {
  const db = getCallStateDb();
  const callId = randomUUID();
  const channel = randomUUID();
  const createdAt = new Date();
  const record: GroupCallRecord = { ...input, callId, channel, status: "active", createdAt, transport: { provider: "agora", version: 1 } };
  try {
    await db.runTransaction(async transaction => {
      const target = ref(db, callId);
      const existing = await transaction.get(target);
      if (existing.exists) throw new Error("duplicate group call ID");
      transaction.create(target, { ...record, participantIds: record.participants.map(participant => participant.userId) });
    });
    return record;
  } catch {
    throw new CallPushError("Call state group creation failed");
  }
}

export async function getGroupCall(callId: string): Promise<GroupCallRecord | null> {
  if (!isValidCallId(callId)) return null;
  const db = getCallStateDb();
  const snapshot = await ref(db, callId).get();
  return snapshot.exists && snapshot.data() ? canonical(callId, snapshot.data()!) : null;
}

export async function answerGroupCall(callId: string, userId: number, sessionId: string, deviceId: string): Promise<GroupCallRecord | null> {
  const db = getCallStateDb();
  let result: GroupCallRecord | null = null;
  await db.runTransaction(async transaction => {
    result = null;
    const snapshot = await transaction.get(ref(db, callId));
    const current = snapshot.exists && snapshot.data() ? canonical(callId, snapshot.data()!) : null;
    if (!current || current.status !== "active") return;
    const participant = current.participants.find(item => item.userId === userId);
    if (!participant || participant.status !== "invited") return;
    const selected = { ...participant, status: "accepted" as const, deviceId, sessionTag: callSessionBinding(sessionId) };
    const participants = current.participants.map(item => item.userId === userId ? selected : item);
    transaction.update(ref(db, callId), { participants, updatedAt: new Date() });
    result = { ...current, participants };
  });
  return result;
}

export async function rejectOrLeaveGroupCall(callId: string, userId: number, sessionId: string, deviceId: string, rejected: boolean): Promise<GroupCallRecord | null> {
  const db = getCallStateDb();
  let result: GroupCallRecord | null = null;
  await db.runTransaction(async transaction => {
    result = null;
    const snapshot = await transaction.get(ref(db, callId));
    const current = snapshot.exists && snapshot.data() ? canonical(callId, snapshot.data()!) : null;
    if (!current || current.status !== "active") return;
    const participant = current.participants.find(item => item.userId === userId);
    if (!participant) return;
    // Creator ending is room-wide. Other members may only leave their selected device.
    if (participant.status === "accepted" &&
        (participant.deviceId !== deviceId || participant.sessionTag !== callSessionBinding(sessionId))) return;
    if (!rejected && userId === current.creatorId) {
      transaction.update(ref(db, callId), { status: "ended", endedAt: new Date(), updatedAt: new Date() });
      result = { ...current, status: "ended", endedAt: new Date() };
      return;
    }
    if (participant.status !== "invited" && participant.status !== "accepted") return;
    const status: GroupParticipantStatus = rejected ? "rejected" : "left";
    const participants = current.participants.map(item => item.userId === userId ? { ...item, status } : item);
    transaction.update(ref(db, callId), { participants, updatedAt: new Date() });
    result = { ...current, participants };
  });
  return result;
}

export function canIssueGroupAgoraToken(call: GroupCallRecord | null, userId: number, sessionId: string, deviceId: string): boolean {
  if (!call || call.status !== "active") return false;
  const participant = call.participants.find(item => item.userId === userId);
  return !!participant && participant.status === "accepted" &&
    participant.deviceId === deviceId && participant.sessionTag === callSessionBinding(sessionId);
}

export function isStoredGroupCallParticipant(call: GroupCallRecord | null, userId: number): boolean {
  return !!call && call.participants.some(participant => participant.userId === userId);
}