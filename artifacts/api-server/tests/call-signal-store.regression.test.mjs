import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  CallPushError,
  SharedFirestore,
  getCallStateDb,
  setAuthoritativeFirestore,
} from "./helpers/call-signal-firebase-mock.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const apiRoot = path.resolve(here, "..");
const storeSource = path.join(apiRoot, "src/lib/call-signal-store.ts");
const signalingSource = path.join(apiRoot, "src/lib/signaling.ts");
const callStateMock = path.join(here, "helpers/call-signal-firebase-mock.mjs");

async function loadReplica(label) {
  const destination = path.join(await mkdtemp(path.join(os.tmpdir(), "call-signal-store-")), `${label}.mjs`);
  await build({
    entryPoints: [storeSource],
    outfile: destination,
    platform: "node",
    format: "esm",
    bundle: true,
    logLevel: "silent",
    plugins: [{
      name: "test-call-state-db",
      setup(plugin) {
        plugin.onResolve({ filter: /^\.\/call-state-db$/ }, (args) => {
          if (args.importer === storeSource) return { path: callStateMock, external: true };
          return undefined;
        });
      },
    }],
  });
  return import(`${pathToFileURL(destination).href}?replica=${label}`);
}

async function loadSignalingReplica(label) {
  const destination = path.join(await mkdtemp(path.join(os.tmpdir(), "call-signaling-")), `${label}.mjs`);
  await build({
    entryPoints: [signalingSource],
    outfile: destination,
    platform: "node",
    format: "esm",
    bundle: true,
    logLevel: "silent",
    plugins: [{
      name: "test-signaling-dependencies",
      setup(plugin) {
        plugin.onLoad({ filter: /signaling\.ts$/ }, async (args) => ({
          contents: `${await readFile(args.path, "utf8")}\nexport { subscribeCalls };\n`,
          loader: "ts",
        }));
        plugin.onResolve({ filter: /^\.\/call-state-db$/ }, () => ({ path: callStateMock, external: true }));
        plugin.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "signaling-test" }));
        plugin.onResolve({ filter: /^\.\/turn-config$/ }, () => ({ path: "turn", namespace: "signaling-test" }));
        plugin.onResolve({ filter: /^ws$/ }, () => ({ path: "ws", namespace: "signaling-test" }));
        plugin.onLoad({ filter: /.*/, namespace: "signaling-test" }, (args) => ({
          contents: args.path === "db"
            ? "export const pool = undefined;"
            : args.path === "turn"
              ? "export function requireReadyCallMediaProvider() { return 'webrtc'; }"
              : "export class WebSocket { static OPEN = 1; } export class WebSocketServer {}",
          loader: "js",
        }));
      },
    }],
  });
  return import(`${pathToFileURL(destination).href}?replica=${label}`);
}

// Separate esbuild outputs deliberately create independent module graphs. Their
// only shared dependency is the adapter above, just like separate API replicas
// sharing Firestore rather than process memory.
const [replicaA, replicaB, signalingReplicaA, signalingReplicaB] = await Promise.all([
  loadReplica("a"), loadReplica("b"), loadSignalingReplica("a"), loadSignalingReplica("b"),
]);
assert.notEqual(replicaA, replicaB);

let callNumber = 0;
function callInput(overrides = {}) {
  callNumber += 1;
  return {
    callId: `call_${callNumber}`,
    caller: { id: 101, name: "Caller", avatar: null },
    callee: { id: 202, name: "Callee", avatar: null },
    type: "video",
    deferredMedia: false,
    transport: { provider: "webrtc", version: 1 },
    initialOffer: { type: "offer", sdp: `offer-${callNumber}` },
    latestOffer: { type: "offer", sdp: `offer-${callNumber}` },
    callerSessionId: "caller-session",
    callerDeviceId: "caller-device",
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function useSharedFirestore() {
  const db = new SharedFirestore();
  setAuthoritativeFirestore(db);
  return db;
}

class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.messages = [];
  }

  send(raw) {
    this.messages.push(JSON.parse(raw));
  }
}

async function settleListeners() {
  for (let tick = 0; tick < 6; tick += 1) await new Promise(resolve => setImmediate(resolve));
}

test("replica B resumes a call created in replica A with its original offer", async () => {
  useSharedFirestore();
  const input = callInput();
  await replicaA.createAuthoritativeCall(input);

  const resumed = await replicaB.getAuthoritativeCall(input.callId);
  assert.equal(resumed?.status, "ringing");
  assert.deepEqual(resumed?.initialOffer, input.initialOffer);
  assert.deepEqual(resumed?.latestOffer, input.latestOffer);
  assert.equal(resumed?.callerSessionTag, "test-session:caller-session");
});

test("concurrent answers across replicas choose exactly one device", async () => {
  useSharedFirestore();
  const input = callInput();
  await replicaA.createAuthoritativeCall(input);

  const [first, second] = await Promise.all([
    replicaA.answerAuthoritativeCall(input.callId, 202, "callee-a", "device-a", { type: "answer", sdp: "a" }),
    replicaB.answerAuthoritativeCall(input.callId, 202, "callee-b", "device-b", { type: "answer", sdp: "b" }),
  ]);
  const accepted = [first, second].filter(Boolean);
  assert.equal(accepted.length, 1);
  const record = await replicaB.getAuthoritativeCall(input.callId);
  assert.equal(record?.status, "answered");
  assert.deepEqual(record?.answerer, accepted[0].answerer);
  assert.equal(record?.latestAnswer?.sdp, accepted[0].latestAnswer?.sdp);
});

test("caller cancellation wins a cancel-versus-answer race and cannot be answered afterward", async () => {
  useSharedFirestore();
  const input = callInput();
  await replicaA.createAuthoritativeCall(input);

  const [cancelled, answered] = await Promise.all([
    replicaA.terminateAuthoritativeCall(input.callId, 101, "caller-session", "caller-device", "missed"),
    replicaB.answerAuthoritativeCall(input.callId, 202, "callee-session", "callee-device", { type: "answer", sdp: "late" }),
  ]);
  assert.equal(cancelled?.status, "missed");
  assert.equal(answered, null);
  assert.equal((await replicaA.getAuthoritativeCall(input.callId))?.status, "missed");
});

test("wrong caller binding and non-winning callee device cannot signal or terminate", async () => {
  useSharedFirestore();
  const input = callInput();
  await replicaA.createAuthoritativeCall(input);
  await replicaB.answerAuthoritativeCall(input.callId, 202, "winner-session", "winner-device", { type: "answer", sdp: "ok" });

  assert.equal(await replicaA.appendAuthoritativeSignal({
    callId: input.callId, userId: 101, sessionId: "stolen-session", deviceId: "caller-device",
    kind: "ice-candidate", payload: { candidate: "bad-caller" },
  }), null);
  assert.equal(await replicaB.appendAuthoritativeSignal({
    callId: input.callId, userId: 202, sessionId: "wrong-session", deviceId: "other-device",
    kind: "ice-candidate", payload: { candidate: "bad-callee" },
  }), null);
  assert.equal(await replicaA.terminateAuthoritativeCall(
    input.callId, 101, "stolen-session", "caller-device", "ended",
  ), null);
  assert.equal(await replicaB.terminateAuthoritativeCall(
    input.callId, 202, "wrong-session", "other-device", "ended",
  ), null);
  assert.equal((await replicaA.getAuthoritativeCall(input.callId))?.status, "answered");
});

test("only a bound caller or winning callee can durably switch WebRTC to Agora", async () => {
  useSharedFirestore();
  const input = callInput();
  await replicaA.createAuthoritativeCall(input);
  assert.equal(await replicaB.switchAuthoritativeCallProvider(
    input.callId, 101, "stolen-session", "caller-device",
  ), null);
  const changed = await replicaA.switchAuthoritativeCallProvider(
    input.callId, 101, "caller-session", "caller-device",
  );
  assert.deepEqual(changed?.transport, { provider: "agora", version: 1 });
  // The persisted Agora transport is one-way; neither party can downgrade it.
  assert.equal(await replicaB.switchAuthoritativeCallProvider(
    input.callId, 202, "other-session", "other-device",
  ), null);
  assert.deepEqual((await replicaB.getAuthoritativeCall(input.callId))?.transport, { provider: "agora", version: 1 });
});

test("an invited E2EE callee device can request hybrid Agora failover before answering", async () => {
  useSharedFirestore();
  const input = callInput({ e2e: { devices: { native_callee_device: { wrappedSecret: "wrapped", fingerprint: "key" } } } });
  await replicaA.createAuthoritativeCall(input);
  assert.equal(await replicaA.switchAuthoritativeCallProvider(
    input.callId, 202, "native-session", "unlisted-device",
  ), null);
  const changed = await replicaB.switchAuthoritativeCallProvider(
    input.callId, 202, "native-session", "native_callee_device",
  );
  assert.deepEqual(changed?.transport, { provider: "agora", version: 1 });
  assert.equal(changed?.status, "ringing");
  assert.equal(changed?.answerer, undefined);
});

test("pre-answer ICE keeps callee candidates private until the winning device is selected", async () => {
  useSharedFirestore();
  const input = callInput();
  await replicaA.createAuthoritativeCall(input);

  const callerIce = await replicaA.appendAuthoritativeSignal({
    callId: input.callId, userId: 101, sessionId: "caller-session", deviceId: "caller-device",
    kind: "ice-candidate", payload: { candidate: "caller-before-answer" },
  });
  const losingIce = await replicaB.appendAuthoritativeSignal({
    callId: input.callId, userId: 202, sessionId: "loser-session", deviceId: "loser-device",
    kind: "ice-candidate", payload: { candidate: "loser-before-answer" },
  });
  const winnerIce = await replicaA.appendAuthoritativeSignal({
    callId: input.callId, userId: 202, sessionId: "winner-session", deviceId: "winner-device",
    kind: "ice-candidate", payload: { candidate: "winner-before-answer" },
  });
  assert.equal(callerIce, null);
  assert.equal(losingIce, null);
  assert.equal(winnerIce, null);

  const accepted = await replicaB.answerAuthoritativeCall(
    input.callId, 202, "winner-session", "winner-device", { type: "answer", sdp: "winner-answer" },
  );
  assert.deepEqual(accepted?.replayIce, {
    caller: [{ candidate: "caller-before-answer" }],
    callee: [{ candidate: "winner-before-answer" }],
  });
  const resumed = await replicaA.getAuthoritativeCall(input.callId);
  assert.deepEqual(resumed?.replayIce, accepted?.replayIce);
  assert.deepEqual(resumed?.preAnswerIce, {});
});

test("an old terminal transaction cannot clear locks acquired by a replacement call", async () => {
  const db = useSharedFirestore();
  const oldCall = callInput();
  await replicaA.createAuthoritativeCall(oldCall);

  // Model a stale ringing document whose short-lived lock has expired, then a
  // fresh invitation acquires those participant locks before stale cleanup runs.
  const oldDocument = db.document(`callInvites/${oldCall.callId}`);
  db.replaceDocument(`callInvites/${oldCall.callId}`, { ...oldDocument, expiresAt: new Date(Date.now() - 1) });
  for (const userId of [101, 202]) {
    const lock = db.document(`callLocks/${userId}`);
    db.replaceDocument(`callLocks/${userId}`, { ...lock, expiresAt: new Date(Date.now() - 1) });
  }
  const replacement = callInput();
  await replicaB.createAuthoritativeCall(replacement);
  await replicaA.terminateAuthoritativeCall(oldCall.callId, 101, "caller-session", "caller-device", "missed");

  assert.equal(db.document("callLocks/101")?.callId, replacement.callId);
  assert.equal(db.document("callLocks/202")?.callId, replacement.callId);
  await assert.rejects(
    () => replicaA.createAuthoritativeCall(callInput()),
    (error) => error instanceof CallPushError && error.message === "A participant is already in a call",
  );
});

test("deferred WebRTC calls accept null consent answers without losing the offer", async () => {
  useSharedFirestore();
  const input = callInput({ deferredMedia: true });
  await replicaA.createAuthoritativeCall(input);

  const accepted = await replicaB.answerAuthoritativeCall(
    input.callId, 202, "consent-session", "consent-device", null,
  );
  assert.equal(accepted?.status, "answered");
  assert.equal(accepted?.initialAnswer, null);
  const stored = await replicaA.getAuthoritativeCall(input.callId);
  assert.equal(stored?.latestAnswer, null);
  assert.deepEqual(stored?.initialOffer, input.initialOffer);
});

test("aborted answer and append attempts do not leak results from a discarded transaction callback", async () => {
  let db = useSharedFirestore();
  const answerCall = callInput();
  await replicaA.createAuthoritativeCall(answerCall);

  db.abortNextTransactionBeforeCommit((firestore) => {
    const current = firestore.document(`callInvites/${answerCall.callId}`);
    firestore.replaceDocument(`callInvites/${answerCall.callId}`, {
      ...current,
      status: "answered",
      endedAt: new Date(),
      answerer: { userId: 202, sessionTag: "test-session:competitor", deviceId: "competitor-device" },
      latestAnswer: { type: "answer", sdp: "competitor-answer" },
    });
  });
  const leakedAnswer = await replicaB.answerAuthoritativeCall(
    answerCall.callId, 202, "retrying-session", "retrying-device", { type: "answer", sdp: "discarded-answer" },
  );
  assert.equal(leakedAnswer, null);
  assert.equal((await replicaA.getAuthoritativeCall(answerCall.callId))?.latestAnswer?.sdp, "competitor-answer");

  // A fresh call prevents the competitor's still-active locks from masking the
  // append retry scenario.
  db = useSharedFirestore();
  const signalCall = callInput();
  await replicaA.createAuthoritativeCall(signalCall);
  await replicaB.answerAuthoritativeCall(
    signalCall.callId, 202, "winner-session", "winner-device", { type: "answer", sdp: "accepted" },
  );
  db.abortNextTransactionBeforeCommit((firestore) => {
    const current = firestore.document(`callInvites/${signalCall.callId}`);
    firestore.replaceDocument(`callInvites/${signalCall.callId}`, { ...current, endedAt: new Date() });
  });
  const leakedSignal = await replicaA.appendAuthoritativeSignal({
    callId: signalCall.callId, userId: 101, sessionId: "caller-session", deviceId: "caller-device",
    kind: "ice-candidate", payload: { candidate: "discarded-signal" },
  });
  assert.equal(leakedSignal, null);
  assert.equal((await db.collection(`callInvites/${signalCall.callId}/events`).get()).size, 0);
});

test("the durable signal event stream retains more than 48 events", async () => {
  const db = useSharedFirestore();
  const input = callInput();
  await replicaA.createAuthoritativeCall(input);
  await replicaB.answerAuthoritativeCall(
    input.callId, 202, "winner-session", "winner-device", { type: "answer", sdp: "accepted" },
  );

  for (let index = 0; index < 49; index += 1) {
    const signal = await replicaA.appendAuthoritativeSignal({
      callId: input.callId, userId: 101, sessionId: "caller-session", deviceId: "caller-device",
      kind: "ice-candidate", payload: { candidate: `retained-${index}` },
    });
    assert.equal(signal?.seq, index + 1);
  }
  const events = await db.collection(`callInvites/${input.callId}/events`).get();
  assert.equal(events.size, 49);
  assert.equal((await replicaB.getAuthoritativeCall(input.callId))?.replayIce.caller.length, 32);
});

test("subscribeCalls drains pre-answer ICE after the answer snapshot, in order, without leaking to another caller device", async () => {
  const db = useSharedFirestore();
  const input = callInput();
  await replicaA.createAuthoritativeCall(input);
  for (const [sessionId, deviceId, candidate] of [
    ["caller-session", "caller-device", "caller-pending"],
    ["loser-session", "loser-device", "loser-pending"],
    ["winner-session", "winner-device", "winner-pending-1"],
    ["winner-session", "winner-device", "winner-pending-2"],
  ]) {
    await replicaB.appendAuthoritativeSignal({
      callId: input.callId,
      userId: candidate === "caller-pending" ? 101 : 202,
      sessionId,
      deviceId,
      kind: "ice-candidate",
      payload: { candidate },
    });
  }
  assert.equal((await db.collection(`callInvites/${input.callId}/events`).get()).size, 4);

  const callerSocket = new FakeSocket();
  const selectedCalleeSocket = new FakeSocket();
  const otherCallerDeviceSocket = new FakeSocket();
  const stopCaller = await signalingReplicaA.subscribeCalls({
    ws: callerSocket, userId: 101, sessionId: "caller-session", deviceId: "caller-device", username: "caller", liveId: null,
  });
  const stopCallee = await signalingReplicaA.subscribeCalls({
    ws: selectedCalleeSocket, userId: 202, sessionId: "winner-session", deviceId: "winner-device", username: "callee", liveId: null,
  });
  const stopOtherCaller = await signalingReplicaA.subscribeCalls({
    ws: otherCallerDeviceSocket, userId: 101, sessionId: "caller-session", deviceId: "other-caller-device", username: "caller", liveId: null,
  });
  await settleListeners();
  assert.ok(callerSocket.messages.some(message => message.type === "call-ready"));
  assert.ok(selectedCalleeSocket.messages.some(message => message.type === "call-incoming"));
  assert.equal(callerSocket.messages.some(message => message.type === "ice-candidate"), false);
  assert.equal(selectedCalleeSocket.messages.some(message => message.type === "ice-candidate"), false);
  assert.deepEqual(otherCallerDeviceSocket.messages, []);

  await replicaA.answerAuthoritativeCall(
    input.callId, 202, "winner-session", "winner-device", { type: "answer", sdp: "accepted" },
  );
  // The answer changes only the parent call document; no event was appended.
  assert.equal((await db.collection(`callInvites/${input.callId}/events`).get()).size, 4);
  await settleListeners();

  const callerTypes = callerSocket.messages.map(message => message.type);
  const callerIce = callerSocket.messages.filter(message => message.type === "ice-candidate");
  assert.ok(callerTypes.indexOf("call-accepted") >= 0);
  assert.ok(callerTypes.indexOf("call-accepted") < callerTypes.indexOf("ice-candidate"));
  assert.deepEqual(callerIce.map(message => message.candidate), ["winner-pending-1", "winner-pending-2"]);
  const calleeTypes = selectedCalleeSocket.messages.map(message => message.type);
  const calleeIce = selectedCalleeSocket.messages.filter(message => message.type === "ice-candidate");
  assert.ok(calleeTypes.indexOf("call-resumed") >= 0);
  assert.ok(calleeTypes.indexOf("call-resumed") < calleeTypes.indexOf("ice-candidate"));
  assert.deepEqual(calleeIce.map(message => message.candidate), ["caller-pending"]);
  assert.deepEqual(otherCallerDeviceSocket.messages, []);

  const resumedReplicaSocket = new FakeSocket();
  const stopResumed = await signalingReplicaB.subscribeCalls({
    ws: resumedReplicaSocket, userId: 101, sessionId: "caller-session", deviceId: "caller-device", username: "caller", liveId: null,
  });
  await settleListeners();
  const resumedTypes = resumedReplicaSocket.messages.map(message => message.type);
  assert.ok(resumedTypes.indexOf("call-accepted") >= 0);
  assert.ok(resumedTypes.indexOf("call-accepted") < resumedTypes.indexOf("ice-candidate"));
  assert.deepEqual(
    resumedReplicaSocket.messages.filter(message => message.type === "ice-candidate").map(message => message.candidate),
    ["winner-pending-1", "winner-pending-2"],
  );

  stopCaller();
  stopCallee();
  stopOtherCaller();
  stopResumed();
});

test("terminal calls cannot append signals, be re-answered, or resurrect their state", async () => {
  const db = useSharedFirestore();
  const input = callInput();
  await replicaA.createAuthoritativeCall(input);
  const ended = await replicaB.terminateAuthoritativeCall(
    input.callId, 202, "unselected-callee", "any-device", "declined",
  );
  assert.equal(ended?.status, "declined");

  assert.equal(await replicaA.appendAuthoritativeSignal({
    callId: input.callId, userId: 101, sessionId: "caller-session", deviceId: "caller-device",
    kind: "ice-candidate", payload: { candidate: "after-terminal" },
  }), null);
  assert.equal(await replicaB.answerAuthoritativeCall(
    input.callId, 202, "callee-session", "callee-device", { type: "answer", sdp: "after-terminal" },
  ), null);
  const finalRecord = await replicaA.getAuthoritativeCall(input.callId);
  assert.equal(finalRecord?.status, "declined");
  assert.deepEqual(finalRecord?.replayIce, { caller: [], callee: [] });
  assert.equal((await db.collection(`callInvites/${input.callId}/events`).get()).size, 0);
});