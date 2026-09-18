import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const apiRoot = path.resolve(here, "..");
const output = path.join(await mkdtemp(path.join(os.tmpdir(), "message-upload-policy-")), "policy.cjs");
await build({
  entryPoints: [path.join(apiRoot, "src/lib/message-upload-policy.ts")],
  outfile: output,
  platform: "node",
  format: "cjs",
  bundle: true,
  logLevel: "silent",
});
const policy = await import(pathToFileURL(output).href);

test("message image upload bounds account only for the AES-GCM tag", () => {
  const encryptedImage = { roomId: 9, encryptedImage: true };
  const legacy = { roomId: null, encryptedImage: false };
  assert.equal(policy.messageUploadByteLimit(encryptedImage, "application/octet-stream"), 5 * 1024 * 1024 + 16);
  assert.equal(policy.messageUploadByteLimit(encryptedImage, "image/png"), 5 * 1024 * 1024);
  assert.equal(policy.messageUploadByteLimit(legacy, "image/png"), 5 * 1024 * 1024);
  assert.equal(policy.messageUploadByteLimit(legacy, "application/octet-stream"), 25 * 1024 * 1024 + 16);
  assert.equal(policy.messageUploadByteLimit(legacy, "video/mp4"), 25 * 1024 * 1024);
});

test("declared encrypted images require a valid room and membership", async () => {
  let membershipChecks = 0;
  const getMembership = async (roomId, userId) => {
    membershipChecks++;
    assert.equal(roomId, 42);
    assert.equal(userId, 7);
    return null;
  };

  await assert.rejects(
    policy.authorizeMessageUpload({ kind: "image" }, 7, getMembership),
    (error) => error.status === 400 && /roomId/.test(error.message),
  );
  assert.equal(membershipChecks, 0);

  await assert.rejects(
    policy.authorizeMessageUpload({ kind: "image", roomId: "42" }, 7, getMembership),
    (error) => error.status === 403,
  );
  assert.equal(membershipChecks, 1);
});

test("every supplied roomId is authorized before upload intent is returned", async () => {
  const order = [];
  const intent = await policy.authorizeMessageUpload(
    { roomId: "12" },
    3,
    async () => {
      order.push("membership");
      return { roomId: 12 };
    },
  );
  order.push("consume");
  assert.deepEqual(order, ["membership", "consume"]);
  assert.deepEqual(intent, { roomId: 12, encryptedImage: false });
});