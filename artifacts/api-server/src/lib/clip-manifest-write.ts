import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { ClipUploadError } from "./clip-upload-protocol.js";

export const MANIFEST_MUTATION_INTERVAL_MS = 1200;
export const MANIFEST_WRITE_MAX_ATTEMPTS = 6;

type Dependencies = {
  save(name: string, json: string, generation: string | 0): Promise<void>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
};
type Slot = { tail: Promise<void>; nextAt: number; pending: number };

/**
 * GCS permits about one mutation/second for an individual object. A fast Tus
 * stream updates its tiny manifest more often than that even though every media
 * chunk has a unique name. Pace only this mutable object, not unrelated uploads.
 * Cross-replica throttling is recovered with bounded 429 backoff.
 *
 * Every retry uses EXACTLY the original serialized bytes and CAS generation.
 * Never fetch a fresh generation to force an old offset over another writer.
 */
export function createClipManifestWriter(dependencies: Dependencies) {
  const now = dependencies.now ?? (() => performance.now());
  const sleep = dependencies.sleep ?? (milliseconds => delay(milliseconds));
  const random = dependencies.random ?? Math.random;
  const slots = new Map<string, Slot>();

  return async (name: string, value: unknown, generation: string | 0): Promise<void> => {
    const json = JSON.stringify(value);
    let slot = slots.get(name);
    if (!slot) {
      slot = { tail: Promise.resolve(), nextAt: 0, pending: 0 };
      slots.set(name, slot);
    }
    const previous = slot.tail;
    let release!: () => void;
    slot.tail = new Promise<void>(resolve => { release = resolve; });
    slot.pending++;
    await previous;
    try {
      for (let attempt = 0; attempt < MANIFEST_WRITE_MAX_ATTEMPTS; attempt++) {
        const wait = Math.max(0, slot.nextAt - now());
        if (wait) await sleep(wait);
        try {
          await dependencies.save(name, json, generation);
          return;
        } catch (error) {
          const code = Number((error as { code?: unknown; statusCode?: unknown })?.code ??
            (error as { statusCode?: unknown })?.statusCode);
          if (code === 412) {
            throw new ClipUploadError(409, "Upload changed concurrently; resume with HEAD");
          }
          if (code !== 429) throw error;
          if (attempt + 1 === MANIFEST_WRITE_MAX_ATTEMPTS) {
            throw new ClipUploadError(503, "Object storage is busy; resume with HEAD and retry");
          }
          const backoff = Math.min(8000, MANIFEST_MUTATION_INTERVAL_MS * 2 ** attempt) +
            Math.floor(random() * 250);
          // nextAt is set below after the failed request has fully settled,
          // not at its start; variable network latency cannot erase spacing.
          slot.nextAt = now() + backoff;
        } finally {
          slot.nextAt = Math.max(slot.nextAt, now() + MANIFEST_MUTATION_INTERVAL_MS);
        }
      }
    } finally {
      slot.pending--;
      release();
      const completedSlot = slot;
      const cleanup = setTimeout(() => {
        if (completedSlot.pending === 0 && completedSlot.nextAt <= now() && slots.get(name) === completedSlot) {
          slots.delete(name);
        }
      }, Math.max(MANIFEST_MUTATION_INTERVAL_MS, completedSlot.nextAt - now()) + 1);
      cleanup.unref();
    }
  };
}