import assert from "node:assert/strict";
import test from "node:test";
import {
  clipsFeedPage,
  DEFAULT_CLIPS_FEED_LIMIT,
  parseClipsFeedQuery,
} from "./clips-feed.js";

test("clips feed query uses the bounded default without a cursor", () => {
  assert.deepEqual(parseClipsFeedQuery({}), {
    ok: true,
    before: null,
    limit: DEFAULT_CLIPS_FEED_LIMIT,
    q: "",
  });
});

test("clips feed query accepts a bounded limit and positive cursor", () => {
  assert.deepEqual(parseClipsFeedQuery({ before: "42", limit: "6" }), {
    ok: true,
    before: 42,
    limit: 6,
    q: "",
  });
  assert.deepEqual(parseClipsFeedQuery({ limit: "10", q: "  HELX  " }), {
    ok: true,
    before: null,
    limit: 10,
    q: "HELX",
  });
});

test("clips feed query rejects invalid limits and cursors", () => {
  for (const limit of ["0", "-1", "1.5", "11", "9007199254740992", "", ["6"]]) {
    assert.deepEqual(parseClipsFeedQuery({ limit }), { ok: false, parameter: "limit" });
  }
  for (const before of ["0", "-1", "1.5", "9007199254740992", "", ["42"]]) {
    assert.deepEqual(parseClipsFeedQuery({ before }), { ok: false, parameter: "before" });
  }
  assert.deepEqual(parseClipsFeedQuery({ q: ["term"] }), { ok: false, parameter: "q" });
  assert.deepEqual(parseClipsFeedQuery({ q: "x".repeat(101) }), { ok: false, parameter: "q" });
});

test("clips feed page emits the requested records and a cursor only when more exist", () => {
  const fetched = [
    { id: 9, title: "nine" },
    { id: 8, title: "eight" },
    { id: 7, title: "seven" },
  ];

  assert.deepEqual(clipsFeedPage(fetched, 2), {
    clips: fetched.slice(0, 2),
    hasMore: true,
    nextBefore: 8,
  });
  assert.deepEqual(clipsFeedPage(fetched.slice(0, 2), 2), {
    clips: fetched.slice(0, 2),
    hasMore: false,
    nextBefore: null,
  });
});