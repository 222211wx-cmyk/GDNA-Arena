import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  answerAuthoritativeCall,
  cleanupStaleAuthoritativeCalls,
  createAuthoritativeCall,
  expireAuthoritativeCall,
  getAuthoritativeCall,
  heartbeatAuthoritativeCall,
  setCallPushSinksForTest,
  terminateAuthoritativeCall,
} from "./call-signal-store";
import { getCallStateDb } from "./call-state-db";

after(async () => { await pool.end(); });

const noPush = {
  incoming: async () => {},
  terminal: async () => {},
};
setCallPushSinksForTest(noPush);

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

test("authoritative call entrypoints dispatch post-commit incoming and terminal pushes", { concurrency: false }, async t => {
  if (!await databaseReady()) { t.skip("call_state_documents migration is not applied"); return; }
  const callId = `pgPushEntry_${randomUUID().replaceAll("-", "")}`;
  t.after(async () => {
    setCallPushSinksForTest(noPush);
    await clearCall(callId);
  });
  const incoming: string[] = [];
  const terminal: string[] = [];
  setCallPushSinksForTest({
    incoming: async input => { incoming.push(`${input.callId}:${input.calleeId}`); },
    terminal: async input => { terminal.push(`${input.callId}:${input.status}`); },
  });
  const input = {
    callId,
    caller: { id: -900011, name: "caller", avatar: null },
    callee: { id: -900012, name: "callee", avatar: null },
    type: "voice" as const,
    deferredMedia: true,
    transport: { provider: "webrtc" as const, version: 1 as const },
    initialOffer: null,
    latestOffer: null,
    e2e: undefined,
    callerDeviceId: "caller-device",
    callerSessionId: "caller-session",
  };
  await createAuthoritativeCall(input);
  assert.deepEqual(incoming, [`${callId}:${input.callee.id}`]);
  const accepted = await answerAuthoritativeCall(
    callId,
    input.callee.id,
    "callee-session",
    "callee-device",
    null,
  );
  assert.ok(accepted);
  assert.deepEqual(terminal, [`${callId}:answered`]);
  const ended = await terminateAuthoritativeCall(
    callId,
    input.caller.id,
    input.callerSessionId,
    input.callerDeviceId,
    "ended",
  );
  assert.ok(ended);
  assert.deepEqual(terminal, [`${callId}:answered`, `${callId}:ended`]);
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

// These sixteen regression cases exercise the PostgreSQL adapter itself, not
// Firebase or a replica-local imitation of the signaling authority.
let caseNumber = 0;
const callerSession = "test-caller";
const calleeSession = "test-callee";
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const n = ++caseNumber;
  const callId = `pgLifecycle_${randomUUID().replaceAll("-", "")}`;
  const caller = { id: -910000 - parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16) - n * 2, name: "caller", avatar: null };
  const callee = { id: caller.id - 1, name: "callee", avatar: null };
  t.after(async () => {
    await clearCall(callId);
    await pool.query("DELETE FROM call_state_documents WHERE path = ANY($1)", [
      [`callLocks/${caller.id}`, `callLocks/${callee.id}`],
    ]);
  });
  await createAuthoritativeCall({
    callId, caller, callee, type: "voice", deferredMedia: false,
    transport: { provider: "agora", version: 1 }, initialOffer: null, latestOffer: null,
    callerDeviceId: "caller-device", callerSessionId: callerSession,
  });
  const db = getCallStateDb();
  const lock = (id: number) => db.doc(`callLocks/${id}`);
  const answer = () => answerAuthoritativeCall(callId, callee.id, calleeSession, "callee-device", null);
  const endCaller = () => terminateAuthoritativeCall(callId, caller.id, callerSession, "caller-device", "ended");
  const endCallee = (requested: "declined" | "ended" = "ended") =>
    terminateAuthoritativeCall(callId, callee.id, calleeSession, "callee-device", requested);
  return { callId, caller, callee, db, lock, answer, endCaller, endCallee };
}
type Case = { name: string; run: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void> };
const lifecycleCases: Case[] = [
  { name: "caller cancel releases both ringing locks", run: async f => {
    assert.equal((await f.endCaller())?.status, "missed");
    assert.equal((await f.lock(f.caller.id).get()).exists, false);
    assert.equal((await f.lock(f.callee.id).get()).exists, false);
  }},
  { name: "callee reject releases both ringing locks", run: async f => {
    assert.equal((await f.endCallee("declined"))?.status, "declined");
    assert.equal((await f.lock(f.caller.id).get()).exists, false);
    assert.equal((await f.lock(f.callee.id).get()).exists, false);
  }},
  { name: "caller ends answered call and frees both locks", run: async f => {
    await f.answer(); assert.ok((await f.lock(f.caller.id).get()).exists);
    assert.ok((await f.endCaller())?.endedAt);
    assert.equal((await f.lock(f.callee.id).get()).exists, false);
  }},
  { name: "selected callee ends answered call and frees both locks", run: async f => {
    await f.answer(); assert.ok((await f.endCallee())?.endedAt);
    assert.equal((await f.lock(f.caller.id).get()).exists, false);
  }},
  { name: "duplicate caller end is idempotent", run: async f => {
    await f.endCaller(); assert.equal(await f.endCaller(), null);
  }},
  { name: "duplicate callee rejection is idempotent", run: async f => {
    await f.endCallee("declined"); assert.equal(await f.endCallee("declined"), null);
  }},
  { name: "ringing timeout expires and releases busy state", run: async f => {
    await f.db.doc(`callInvites/${f.callId}`).update({ expiresAt: new Date(Date.now() - 1) });
    assert.equal((await expireAuthoritativeCall(f.callId))?.status, "missed");
    assert.equal((await f.lock(f.caller.id).get()).exists, false);
  }},
  { name: "duplicate timeout cannot rewrite terminal call", run: async f => {
    await f.db.doc(`callInvites/${f.callId}`).update({ expiresAt: new Date(Date.now() - 1) });
    await expireAuthoritativeCall(f.callId);
    assert.equal(await expireAuthoritativeCall(f.callId), null);
  }},
  { name: "setup error termination permits both parties to redial", run: async f => {
    await f.endCaller();
    const nextId = `pgLifecycle_${randomUUID().replaceAll("-", "")}`;
    await createAuthoritativeCall({
      callId: nextId, caller: f.caller, callee: f.callee, type: "voice",
      deferredMedia: false, transport: { provider: "agora", version: 1 },
      initialOffer: null, latestOffer: null, callerDeviceId: "caller-device", callerSessionId: callerSession,
    });
    assert.equal((await f.lock(f.callee.id).get()).data()?.callId, nextId);
    await terminateAuthoritativeCall(nextId, f.caller.id, callerSession, "caller-device", "ended");
    const reversed = `pgLifecycle_${randomUUID().replaceAll("-", "")}`;
    await createAuthoritativeCall({
      callId: reversed, caller: f.callee, callee: f.caller, type: "voice",
      deferredMedia: false, transport: { provider: "agora", version: 1 },
      initialOffer: null, latestOffer: null, callerDeviceId: "callee-device", callerSessionId: calleeSession,
    });
    assert.equal((await f.lock(f.caller.id).get()).data()?.callId, reversed);
    await clearCall(reversed);
    await clearCall(nextId);
  }},
  { name: "accepted calls remain active without terminal timestamp", run: async f => {
    await f.answer(); assert.equal((await getAuthoritativeCall(f.callId))?.status, "answered");
    assert.equal((await getAuthoritativeCall(f.callId))?.endedAt, undefined);
  }},
  { name: "wrong caller session cannot end a call", run: async f => {
    assert.equal(await terminateAuthoritativeCall(f.callId, f.caller.id, "wrong", "caller-device", "ended"), null);
    assert.ok((await f.lock(f.caller.id).get()).exists);
  }},
  { name: "nonselected callee cannot end answered call", run: async f => {
    await f.answer();
    assert.equal(await terminateAuthoritativeCall(f.callId, f.callee.id, "wrong", "callee-device", "ended"), null);
    assert.ok((await f.lock(f.callee.id).get()).exists);
  }},
  { name: "startup cleanup races redial without deleting the new lock", run: async f => {
    await f.db.doc(`callInvites/${f.callId}`).update({ expiresAt: new Date(Date.now() - 121_000) });
    for (const id of [f.caller.id, f.callee.id])
      await f.lock(id).update({ expiresAt: new Date(Date.now() - 121_000) });
    const redialId = `pgLifecycle_${randomUUID().replaceAll("-", "")}`;
    await Promise.all([
      cleanupStaleAuthoritativeCalls(),
      createAuthoritativeCall({
        callId: redialId, caller: f.caller, callee: f.callee, type: "voice",
        deferredMedia: false, transport: { provider: "agora", version: 1 },
        initialOffer: null, latestOffer: null, callerDeviceId: "caller-device", callerSessionId: callerSession,
      }),
    ]);
    assert.ok((await getAuthoritativeCall(f.callId))?.endedAt);
    assert.equal((await f.lock(f.callee.id).get()).data()?.callId, redialId);
    await clearCall(redialId);
  }},
  { name: "startup cleanup preserves fresh answered call", run: async f => {
    await f.answer(); await cleanupStaleAuthoritativeCalls();
    assert.equal((await getAuthoritativeCall(f.callId))?.endedAt, undefined);
  }},
  { name: "legacy web call without heartbeat survives two minute cleanup", run: async f => {
    await f.answer();
    await f.db.doc(`callInvites/${f.callId}`).update({ answeredAt: new Date(Date.now() - 180_000) });
    await cleanupStaleAuthoritativeCalls();
    assert.equal((await getAuthoritativeCall(f.callId))?.endedAt, undefined);
  }},
  { name: "killed answered lease expires without deleting replacement lock or resurrecting on duplicate cleanup", run: async f => {
    await f.answer();
    assert.equal(await heartbeatAuthoritativeCall(f.callId, f.caller.id, callerSession, "caller-device"), true);
    await f.db.doc(`callInvites/${f.callId}`).update({
      lastHeartbeatAt: new Date(Date.now() - 121_000),
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });
    await f.lock(f.caller.id).set({ callId: "replacement", expiresAt: new Date(Date.now() + 60_000), updatedAt: new Date() });
    await cleanupStaleAuthoritativeCalls();
    await cleanupStaleAuthoritativeCalls();
    assert.ok((await getAuthoritativeCall(f.callId))?.endedAt);
    assert.equal((await f.lock(f.caller.id).get()).data()?.callId, "replacement");
    assert.equal((await f.lock(f.callee.id).get()).exists, false);
  }},
];
for (const { name, run } of lifecycleCases) {
  test(`PostgreSQL lifecycle: ${name}`, { concurrency: false }, async t => {
    if (!await databaseReady()) { t.skip("call_state_documents migration is not applied"); return; }
    await run(await fixture(t));
  });
}