import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFERRED_INVITATION_TTL_MS,
  reserveDeferredAnsweringSocket,
} from "./deferred-call-policy";

function ringingCall(calleeId = 22) {
  return {
    deferredMedia: true,
    status: "ringing" as const,
    calleeId,
    calleeSocket: null as any,
  };
}

test("deferred invitations have a server-owned 30 second ring lifetime", () => {
  assert.equal(DEFERRED_INVITATION_TTL_MS, 30_000);
});

test("only the authenticated callee can reserve the deferred answering socket", () => {
  const call = ringingCall();
  const socket = {} as any;
  assert.equal(reserveDeferredAnsweringSocket(call, 7, socket), false);
  assert.equal(call.calleeSocket, null);
  assert.equal(reserveDeferredAnsweringSocket(call, 22, socket), true);
  assert.equal(call.calleeSocket, socket);
});

test("the first callee socket wins and a second device cannot steal it", () => {
  const call = ringingCall();
  const firstDevice = {} as any;
  const secondDevice = {} as any;
  assert.equal(reserveDeferredAnsweringSocket(call, 22, firstDevice), true);
  assert.equal(reserveDeferredAnsweringSocket(call, 22, secondDevice), false);
  assert.equal(call.calleeSocket, firstDevice);
});