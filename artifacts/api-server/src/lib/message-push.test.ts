import assert from "node:assert/strict";
import test from "node:test";
import { fanoutMessageRecipients } from "./message-push.js";

test("message recipient fanout paginates beyond one 500-recipient page", async () => {
  const allRecipients = Array.from({ length: 1_201 }, (_, index) => index + 1);
  const notified: number[] = [];
  const cursors: number[] = [];
  await fanoutMessageRecipients(
    async (afterUserId, limit) => {
      cursors.push(afterUserId);
      return allRecipients.filter(id => id > afterUserId).slice(0, limit);
    },
    async userId => {
      notified.push(userId);
    },
  );
  assert.deepEqual(cursors, [0, 500, 1_000]);
  assert.deepEqual(notified, allRecipients);
});