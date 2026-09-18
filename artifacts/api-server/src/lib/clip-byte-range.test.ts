import test from "node:test";
import assert from "node:assert/strict";
import { clipByteRange } from "./clip-byte-range.js";

test("video ranges include explicit, open-ended, suffix, and oversized-end forms", () => {
  assert.deepEqual(clipByteRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(clipByteRange("bytes=500-", 1000), { start: 500, end: 999 });
  assert.deepEqual(clipByteRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.deepEqual(clipByteRange("bytes=-5000", 1000), { start: 0, end: 999 });
  assert.deepEqual(clipByteRange("bytes=900-5000", 1000), { start: 900, end: 999 });
});

test("malformed, empty, multiple and out-of-bounds ranges cannot stream the wrong bytes", () => {
  for (const range of ["bytes=-", "bytes=-0", "bytes=1000-", "bytes=50-20",
    "bytes=0-1,3-4", "bytes=nope", "other=0-4", "bytes=0-99junk",
    "bytes=999999999999999999999-"]) {
    assert.equal(clipByteRange(range, 1000), null, range);
  }
  assert.equal(clipByteRange("bytes=0-", 0), null);
});