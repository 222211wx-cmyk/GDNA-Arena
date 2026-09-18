import assert from "node:assert/strict";
import test from "node:test";
import { clipWithThumbnail } from "./clips-thumbnail-response.js";

test("thumbnail URLs are scoped to clip IDs and do not disclose object paths", () => {
  assert.deepEqual(clipWithThumbnail({ id: 123, title: "Original", thumbnail_object_name: "private.jpg" }),
    { id: 123, title: "Original", thumb: "/api/clips/thumbnail/123" });
});

test("old clips and failed thumbnail generation stay playable with no poster", () => {
  assert.deepEqual(clipWithThumbnail({ id: 1, thumbnail_object_name: null }), { id: 1, thumb: null });
  assert.deepEqual(clipWithThumbnail({ id: 2 }), { id: 2, thumb: null });
});