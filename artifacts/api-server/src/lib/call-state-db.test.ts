import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { answerAuthoritativeCall, createAuthoritativeCall } from "./call-signal-store";
import { getCallStateDb } from "./call-state-db";

after(async () => { await pool.end(); });

async function clearCall(callId: string) {
  await pool.query(
    "DELETE FROM call_state_documents WHERE path LIKE $1 OR data->>'callId'=$2",
    [`%/${callId}%`, callId],
  );
}

async function databaseReady() {
  if (!process.env.DATABASE_URL) return false;
  try {
    const result = await pool.query<{ present: string | null }>(
      "SELECT to_regclass('public.call_state_documents') AS present",
    );
    return !!result.rows[0]?.present;
  } catch { return false; }
}

test("call state round-trips dates and Firestore-like timestamps through JSONB", { concurrency: false }, async t => {
  if (!await databaseReady()) { t.skip("call_state_documents migration is not applied"); return; }
  const db = getCallStateDb();
  const path = `callStateTest/${randomUUID()}`;
  const created = new Date("2026-01-02T03:04:05.678Z");
  await db.doc(path).set({ createdAt: created, timestamp: { toDate: () => created } });
  const snapshot = await db.doc(path).get();
  assert.equal(snapshot.data()?.createdAt instanceof Date, true);
  assert.equal((snapshot.data()?.createdAt as Date).toISOString(), created.toISOString());
  assert.equal((snapshot.data()?.timestamp as Date).toISOString(), created.toISOString());
  await db.doc(path).delete();
});

test("two durable invitations cannot both win the answer CAS", { concurrency: false }, async t => {
  if (!await databaseReady()) { t.skip("call_state_documents migration is not applied"); return; }
  const callId = `pgAnswer_${randomUUID().replaceAll("-", "")}`;
  t.after(() => clearCall(callId));
  const input = {
    callId,
    caller: { id: -900001, name: "caller", avatar: null },
    callee: { id: -900002, name: "callee", avatar: null },
    type: "video" as const, deferredMedia: false,
    transport: { provider: "webrtc" as const, version: 1 as const },
    initialOffer: { type: "offer", sdp: "offer" },
    latestOffer: { type: "offer", sdp: "offer" },
    e2e: undefined, callerDeviceId: "caller-device", callerSessionId: "caller-session",
  };
  await createAuthoritativeCall(input);
  const answers = await Promise.all([
    answerAuthoritativeCall(callId, input.callee.id, "session-one", "device-one", { type: "answer", sdp: "one" }),
    answerAuthoritativeCall(callId, input.callee.id, "session-two", "device-two", { type: "answer", sdp: "two" }),
  ]);
  assert.equal(answers.filter(Boolean).length, 1);
  const remaining = await getCallStateDb().doc(`callInvites/${callId}`).get();
  assert.equal(remaining.data()?.status, "answered");
  await clearCall(callId);

  const expiredId = `pgExpired_${randomUUID().replaceAll("-", "")}`;
  t.after(() => clearCall(expiredId));
  await createAuthoritativeCall({ ...input, callId: expiredId });
  await getCallStateDb().doc(`callInvites/${expiredId}`).update({ expiresAt: new Date(Date.now() - 1_000) });
  assert.equal(
    await answerAuthoritativeCall(expiredId, input.callee.id, "expired-session", "expired-device", { type: "answer", sdp: "late" }),
    null,
  );
  await clearCall(expiredId);
});

test("a new subscriber replays an already committed invitation after restart", { concurrency: false }, async t => {
  if (!await databaseReady()) { t.skip("call_state_documents migration is not applied"); return; }
  const db = getCallStateDb();
  const callId = `pgReplay_${randomUUID().replaceAll("-", "")}`;
  await db.doc(`callInvites/${callId}`).set({ participantIds: [900003], status: "ringing", expiresAt: new Date(Date.now() + 60_000) });
  await new Promise<void>((resolve, reject) => {
    const stop = db.collection("callInvites").where("participantIds", "array-contains", 900003)
      .onSnapshot(snapshot => {
        if (snapshot.docs.some(doc => doc.id === callId)) { stop(); resolve(); }
      }, reject);
    setTimeout(() => { stop(); reject(new Error("subscriber replay timeout")); }, 5000).unref();
  });
  await pool.query("DELETE FROM call_state_documents WHERE path=$1", [`callInvites/${callId}`]);
});