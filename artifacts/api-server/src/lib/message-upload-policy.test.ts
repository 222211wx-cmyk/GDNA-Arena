import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authorizeMessageUpload, messageUploadByteLimit,
  MAX_ENCRYPTED_ATTACHMENT_BYTES, MAX_ENCRYPTED_IMAGE_BYTES,
} from "./message-upload-policy";

test("encrypted videos require an authorized room and reject invalid kinds", async () => {
  const member = async (room: number, user: number) => room === 7 && user === 9;
  await assert.rejects(authorizeMessageUpload({ kind: "video" }, 9, member), /roomId is required/);
  await assert.rejects(authorizeMessageUpload({ kind: "video", roomId: "7" }, 8, member), /Access denied/);
  await assert.rejects(authorizeMessageUpload({ kind: "unknown", roomId: "7" }, 9, member), /Invalid encrypted attachment kind/);
  const intent = await authorizeMessageUpload({ kind: "video", roomId: "7" }, 9, member);
  assert.equal(messageUploadByteLimit(intent, "application/octet-stream"), 25 * 1024 * 1024);
  assert.equal(MAX_ENCRYPTED_ATTACHMENT_BYTES, 25 * 1024 * 1024);
  assert.equal(messageUploadByteLimit(intent, "video/mp4"), 0);
});

test("encrypted images retain the five MiB plaintext + GCM tag limit", async () => {
  const intent = await authorizeMessageUpload({ kind: "image", roomId: "7" }, 9, async () => true);
  assert.equal(messageUploadByteLimit(intent, "application/octet-stream"), MAX_ENCRYPTED_IMAGE_BYTES);
  assert.equal(MAX_ENCRYPTED_IMAGE_BYTES, 5 * 1024 * 1024 + 16);
});