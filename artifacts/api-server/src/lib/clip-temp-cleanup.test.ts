import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CLIP_TEMP_OWNER_FILE,
  CLIP_TEMP_PREFIX,
  cleanupOrphanedClipTempDirectories,
  markActiveClipTempDirectory,
  startClipTempCleanupWorker,
} from "./clip-temp-cleanup.js";

async function temporary(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "clip-temp-cleanup-test-"));
  try { await run(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("active process-owned directory survives regardless of age", async () => {
  await temporary(async root => {
    const directory = await mkdtemp(join(root, CLIP_TEMP_PREFIX));
    await markActiveClipTempDirectory(directory);
    await writeFile(join(directory, "source"), "active media");
    assert.equal(await cleanupOrphanedClipTempDirectories(root), 0);
    assert.deepEqual((await readdir(directory)).sort(), [CLIP_TEMP_OWNER_FILE, "source"]);
  });
});

test("dead exact PID incarnation is removed without an age cutoff", async () => {
  await temporary(async root => {
    const directory = await mkdtemp(join(root, CLIP_TEMP_PREFIX));
    await writeFile(join(directory, CLIP_TEMP_OWNER_FILE),
      JSON.stringify({ pid: 2_147_483_647, startTime: "1" }));
    await writeFile(join(directory, "encoded.mp4"), "orphan");
    assert.equal(await cleanupOrphanedClipTempDirectories(root), 1);
    assert.deepEqual(await readdir(root), []);
  });
});

test("unmarked, malformed, unrelated, and symlink entries are never removed", async () => {
  await temporary(async root => {
    const unmarked = join(root, `${CLIP_TEMP_PREFIX}unmarked`);
    const malformed = join(root, `${CLIP_TEMP_PREFIX}malformed`);
    const unrelated = join(root, "some-other-application");
    const outside = await mkdtemp(join(tmpdir(), "clip-temp-outside-"));
    await Promise.all([mkdir(unmarked), mkdir(malformed), mkdir(unrelated)]);
    await writeFile(join(malformed, CLIP_TEMP_OWNER_FILE), "not json");
    await writeFile(join(outside, "must-survive"), "private");
    await symlink(outside, join(root, `${CLIP_TEMP_PREFIX}symlink`), "dir");
    try {
      assert.equal(await cleanupOrphanedClipTempDirectories(root), 0);
      assert.equal(await readFile(join(outside, "must-survive"), "utf8"), "private");
      assert.deepEqual((await readdir(root)).sort(), [
        `${CLIP_TEMP_PREFIX}malformed`,
        `${CLIP_TEMP_PREFIX}symlink`,
        `${CLIP_TEMP_PREFIX}unmarked`,
        "some-other-application",
      ]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("worker performs an immediate sweep and stop cancels future sweeps", async () => {
  await temporary(async root => {
    const first = await mkdtemp(join(root, CLIP_TEMP_PREFIX));
    await writeFile(join(first, CLIP_TEMP_OWNER_FILE),
      JSON.stringify({ pid: 2_147_483_647, startTime: "1" }));
    const stop = startClipTempCleanupWorker({ root, intervalMs: 20, onError: assert.fail });
    try {
      for (let attempt = 0; attempt < 50 && (await readdir(root)).length; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.deepEqual(await readdir(root), []);
      stop();
      const second = await mkdtemp(join(root, CLIP_TEMP_PREFIX));
      await writeFile(join(second, CLIP_TEMP_OWNER_FILE),
        JSON.stringify({ pid: 2_147_483_647, startTime: "1" }));
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.deepEqual(await readdir(root), [second.slice(root.length + 1)]);
    } finally {
      stop();
    }
  });
});