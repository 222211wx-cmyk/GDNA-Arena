import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { SharedFirestore, setAuthoritativeFirestore } from "./helpers/call-signal-firebase-mock.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const apiRoot = path.resolve(here, "..");
const source = path.join(apiRoot, "src/lib/group-call-store.ts");
const firebaseMock = path.join(here, "helpers/call-signal-firebase-mock.mjs");
const output = path.join(await mkdtemp(path.join(os.tmpdir(), "group-call-store-")), "store.mjs");
await build({
  entryPoints: [source], outfile: output, platform: "node", format: "esm", bundle: true, logLevel: "silent",
  plugins: [{ name: "firebase", setup(plugin) {
    plugin.onResolve({ filter: /^\.\/firebase-call-push$/ }, () => ({ path: firebaseMock, external: true }));
  } }],
});
// esbuild's ESM bundle of pg uses a CommonJS require for Node built-ins.
globalThis.require = createRequire(import.meta.url);
const store = await import(pathToFileURL(output).href);

test("group Agora join authorization requires the selected accepting device", async () => {
  setAuthoritativeFirestore(new SharedFirestore());
  const call = await store.createGroupCall({
    roomId: 7, creatorId: 10, type: "video", e2e: { devices: { caller_device_1234: "x".repeat(32) } },
    participants: [{ userId: 10, username: "creator", status: "accepted", deviceId: "caller_device_1234", sessionTag: "test-session:creator-session" },
      { userId: 20, username: "member", status: "invited" }],
  });
  assert.equal(store.canIssueGroupAgoraToken(call, 20, "member-session", "member_device_1234"), false);
  const answered = await store.answerGroupCall(call.callId, 20, "member-session", "member_device_1234");
  assert.equal(store.canIssueGroupAgoraToken(answered, 20, "wrong-session", "member_device_1234"), false);
  assert.equal(store.canIssueGroupAgoraToken(answered, 20, "member-session", "member_device_1234"), true);
  // A later room join does not retroactively reveal or authorize this private
  // invitation, even if that user is now a room member.
  assert.equal(store.isStoredGroupCallParticipant(answered, 30), false);
});

test("group call storage retains every wrapped recipient beyond eight devices and fingerprints", async () => {
  setAuthoritativeFirestore(new SharedFirestore());
  const ids = Array.from({ length: 12 }, (_, index) => `group_device_${String(index).padStart(16, "0")}`);
  const devices = Object.fromEntries(ids.map(id => [id, "x".repeat(342)]));
  const fingerprints = Object.fromEntries(ids.map(id => [id, "f".repeat(43)]));
  const created = await store.createGroupCall({
    roomId: 8, creatorId: 10, type: "voice", e2e: { devices, fingerprints },
    participants: [
      { userId: 10, username: "creator", status: "accepted", deviceId: ids[0], sessionTag: "test-session:creator-session" },
      { userId: 20, username: "member", status: "invited" },
    ],
  });
  const restored = await store.getGroupCall(created.callId);
  assert.deepEqual(restored.e2e.devices, devices);
  assert.deepEqual(restored.e2e.fingerprints, fingerprints);
});