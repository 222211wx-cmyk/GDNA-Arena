import assert from "node:assert/strict";
import test from "node:test";
import { providerSibling, r2Key, r2Reference } from "./r2-storage.js";

test("R2 references are provider-qualified and constrained to managed clip namespaces", () => {
  assert.equal(r2Reference("clips/original/7/file.mp4"), "r2:clips/original/7/file.mp4");
  assert.equal(r2Key("r2:clips/derived/poster.jpg"), "clips/derived/poster.jpg");
  assert.equal(
    providerSibling("r2:clips/original/7/file.mp4", "clip_compressed_0123456789abcdef0123456789abcdef.mp4"),
    "r2:clips/derived/clip_compressed_0123456789abcdef0123456789abcdef.mp4",
  );
  assert.equal(providerSibling("historical.mp4", "derived.mp4"), "derived.mp4");
  assert.throws(() => r2Reference("qa/unmanaged.txt"), /Invalid R2 object key/);
  assert.throws(() => r2Key("r2:clips/original/../secret"), /Invalid R2 object key/);
});