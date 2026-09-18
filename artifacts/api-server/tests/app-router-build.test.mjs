import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

const apiRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

test("the complete app and router tree compiles and bundles", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "api-router-smoke-"));
  const result = await build({
    absWorkingDir: apiRoot,
    entryPoints: ["src/app.ts"],
    outfile: path.join(outputDirectory, "app.mjs"),
    platform: "node",
    format: "esm",
    bundle: true,
    packages: "external",
    logLevel: "silent",
    metafile: true,
  });

  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.some(input => input.endsWith("src/app.ts")));
  assert.ok(inputs.some(input => input.endsWith("src/routes/index.ts")));
  assert.ok(inputs.some(input => input.endsWith("src/routes/clips.ts")));
  assert.ok(inputs.some(input => input.endsWith("src/routes/admin-clip-thumbnails.ts")));
});