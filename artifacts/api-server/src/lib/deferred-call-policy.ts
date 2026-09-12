import type { WebSocket } from "ws";

export const DEFERRED_INVITATION_TTL_MS = 30_000;

export interface DeferredAnswerBinding {
  deferredMedia: boolean;
  status: "ringing" | "accepting" | "accepted";
  calleeId: number | null;
  calleeSocket: WebSocket | null;
}

/** Atomically reserve the one callee socket permitted to answer a ringing call. */
export function reserveDeferredAnsweringSocket(
  call: DeferredAnswerBinding,
  userId: number | null,
  socket: WebSocket,
): boolean {
  if (!call.deferredMedia || call.status !== "ringing" || call.calleeId !== userId) return false;
  if (call.calleeSocket && call.calleeSocket !== socket) return false;
  call.calleeSocket = socket;
  return true;
}