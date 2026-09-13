import assert from "node:assert/strict";
import test from "node:test";
import { appendBoundedIce, MAX_BUFFERED_ICE_CANDIDATES } from "./ice-buffer.js";

test("ICE buffering is FIFO and bounded", () => {
  const candidates: number[] = [];
  for (let index = 0; index < MAX_BUFFERED_ICE_CANDIDATES; index += 1) {
    assert.equal(appendBoundedIce(candidates, index), true);
  }
  assert.equal(appendBoundedIce(candidates, MAX_BUFFERED_ICE_CANDIDATES), false);
  assert.equal(candidates.length, MAX_BUFFERED_ICE_CANDIDATES);
  assert.equal(candidates[0], 0);
  assert.equal(candidates.at(-1), MAX_BUFFERED_ICE_CANDIDATES - 1);
});