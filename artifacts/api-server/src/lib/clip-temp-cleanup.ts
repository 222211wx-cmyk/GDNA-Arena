import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CLIP_TEMP_PREFIX = "clip-compress-";
export const CLIP_TEMP_OWNER_FILE = ".helixly-clip-owner.json";
export const DEFAULT_CLIP_TEMP_ROOT = join(tmpdir(), "helixly-clip-processing");
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

type Owner = { pid: number; startTime: string };

function parseStartTime(stat: string): string | null {
  // comm (field 2) may contain spaces or parentheses. Everything after its
  // final ") " starts at field 3; starttime is field 22.
  const close = stat.lastIndexOf(") ");
  if (close < 0) return null;
  return stat.slice(close + 2).trim().split(/\s+/)[19] ?? null;
}

async function processStartTime(pid: number): Promise<string | null> {
  try {
    return parseStartTime(await readFile(`/proc/${pid}/stat`, "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    // Permission errors and non-Linux environments are unknown, not dead.
    throw error;
  }
}

export async function ensureClipTempRoot(root = DEFAULT_CLIP_TEMP_ROOT): Promise<string> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}

/** Mark a newly-created work directory before any media bytes are written. */
export async function markActiveClipTempDirectory(directory: string): Promise<void> {
  const startTime = await processStartTime(process.pid);
  if (!startTime) throw new Error("Cannot identify clip worker process");
  const owner: Owner = { pid: process.pid, startTime };
  await writeFile(join(directory, CLIP_TEMP_OWNER_FILE), JSON.stringify(owner), {
    flag: "wx",
    mode: 0o600,
  });
}

async function isKnownLiveOwner(owner: Owner): Promise<boolean> {
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.startTime !== "string") {
    throw new Error("Invalid clip temp owner");
  }
  const actual = await processStartTime(owner.pid);
  return actual !== null && actual === owner.startTime;
}

/**
 * Remove only marked clip work directories whose exact PID incarnation is
 * gone. Unknown/unreadable state is retained. There is deliberately no age
 * cutoff: a healthy 24-hour encode remains protected for its full lifetime.
 */
export async function cleanupOrphanedClipTempDirectories(root = DEFAULT_CLIP_TEMP_ROOT): Promise<number> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.name.startsWith(CLIP_TEMP_PREFIX) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = join(root, entry.name);
    try {
      const before = await lstat(directory);
      if (!before.isDirectory() || before.isSymbolicLink()) continue;
      const owner = JSON.parse(await readFile(join(directory, CLIP_TEMP_OWNER_FILE), "utf8")) as Owner;
      if (await isKnownLiveOwner(owner)) continue;
      // Recheck the directory identity to narrow replacement races. rm never
      // follows a final-component symlink, but a changed inode is retained.
      const after = await lstat(directory);
      if (!after.isDirectory() || after.isSymbolicLink() ||
          before.dev !== after.dev || before.ino !== after.ino) continue;
      await rm(directory, { recursive: true, force: true });
      removed++;
    } catch {
      // Missing marker, malformed owner, permission failures, and races are all
      // ambiguous. Protect them rather than deleting unrelated/active files.
    }
  }
  return removed;
}

export interface ClipTempCleanupWorkerOptions {
  root?: string;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

/** Start an unref'ed hourly sweep. The returned function stops future sweeps. */
export function startClipTempCleanupWorker(options: ClipTempCleanupWorkerOptions = {}): () => void {
  const sweep = () => {
    void cleanupOrphanedClipTempDirectories(options.root).catch(error => options.onError?.(error));
  };
  sweep();
  const timer = setInterval(sweep, options.intervalMs ?? CLEANUP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}