import { retryThumbnailName } from "./clip-storage-names.js";

const DAY_MS = 86_400_000;
export const MIN_ORPHAN_AGE_DAYS = 30;
export interface ClipReference {
  id: number;
  object_name: string;
  thumbnail_object_name: string | null;
  upload_object_name?: string | null;
  processing_output_object?: string | null;
}
export interface InventoryObject {
  name: string;
  generation?: string;
  metageneration?: string;
  size?: string;
  timeCreated?: string;
  updated?: string;
}
export type Disposition = "candidate" | "protected" | "held";
export interface ReportObject extends InventoryObject {
  disposition: Disposition;
  reason: string;
}

/** Pure classification, deliberately with no storage or database write capability. */
export function reconcileClipStorage(input: {
  objects: InventoryObject[];
  clips: ClipReference[];
  queuedNames: string[];
  scope: { bucket: string; prefix: string };
  startedAt: string;
  now?: number;
  minAgeDays?: number;
}) {
  const now = input.now ?? Date.now();
  const minAgeDays = input.minAgeDays ?? MIN_ORPHAN_AGE_DAYS;
  if (!Number.isSafeInteger(minAgeDays) || minAgeDays < MIN_ORPHAN_AGE_DAYS ||
      !Number.isFinite(now - minAgeDays * DAY_MS)) {
    throw new Error(`min-age-days must be an integer >= ${MIN_ORPHAN_AGE_DAYS}`);
  }
  const cutoff = now - minAgeDays * DAY_MS;
  const protectedNames = new Map<string, string>();
  const clipIds = new Set<string>();
  for (const clip of input.clips) {
    clipIds.add(String(clip.id));
    protectedNames.set(clip.object_name, "live-original");
    if (clip.upload_object_name) protectedNames.set(clip.upload_object_name, "retained-original");
    if (clip.processing_output_object) protectedNames.set(clip.processing_output_object, "pending-compression-output");
    if (clip.thumbnail_object_name) protectedNames.set(clip.thumbnail_object_name, "stored-thumbnail");
    protectedNames.set(retryThumbnailName(clip.id, clip.object_name), "deterministic-retry-candidate");
  }
  const queued = new Set(input.queuedNames);
  const seen = new Set<string>();
  const classify = (object: InventoryObject): [Disposition, string] => {
    if (seen.has(object.name)) throw new Error("Duplicate object in inventory; rerun the report");
    seen.add(object.name);
    const protection = protectedNames.get(object.name);
    if (protection) return ["protected", protection];
    if (object.name.startsWith(".uploads/") || object.name.startsWith("clip_upload_")) {
      return ["protected", "resumable-upload-namespace"];
    }
    const retry = /^thumb_retry_([1-9]\d*)_[0-9a-f]{32}\.jpg$/.exec(object.name);
    // Also hold historical candidate hashes for an extant clip.
    if (retry && clipIds.has(retry[1])) return ["protected", "retry-for-live-clip"];
    if (queued.has(object.name)) return ["protected", "already-queued"];
    if (!/^(clip_[0-9a-f]{32}\.(mp4|mov|webm|mp3|m4a|aac|ogg|wav|flac)|thumb_[0-9a-f]{32}\.jpg)$/.test(object.name) && !retry) {
      return ["held", "unrecognized-name"];
    }
    const created = Date.parse(object.timeCreated ?? "");
    const updated = Date.parse(object.updated ?? "");
    if (!/^[1-9]\d*$/.test(object.generation ?? "") || !/^(0|[1-9]\d*)$/.test(object.size ?? "") ||
        !Number.isFinite(created) || !Number.isFinite(updated) || updated < created) {
      return ["held", "missing-or-invalid-metadata"];
    }
    if (Math.max(created, updated) > cutoff) return ["held", "too-recent-or-pending"];
    return ["candidate", "old-recognized-unreferenced-object"];
  };
  const inventory: ReportObject[] = input.objects.map(object => {
    const [disposition, reason] = classify(object);
    return { ...object, disposition, reason };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const candidates = inventory.filter(object => object.disposition === "candidate");
  const counts: Record<Disposition, number> = { candidate: 0, protected: 0, held: 0 };
  const reasons: Record<string, number> = {};
  for (const object of inventory) {
    counts[object.disposition]++;
    reasons[object.reason] = (reasons[object.reason] ?? 0) + 1;
  }
  return {
    schemaVersion: 1,
    mode: "read-only-dry-run",
    complete: true,
    scope: input.scope,
    startedAt: input.startedAt,
    generatedAt: new Date(now).toISOString(),
    minAgeDays,
    cutoff: new Date(cutoff).toISOString(),
    approvalRequired: true,
    warning: "Not deletion authorization. Verify exclusive environment ownership, quiesce writers, recheck references and generations, and obtain explicit approval of exact objects before any separate enqueue. This tool never enqueues.",
    summary: {
      totalObjects: inventory.length, ...counts, reasons,
      candidateBytes: candidates.reduce((total, object) => total + BigInt(object.size!), 0n).toString(),
    },
    candidates,
    inventory,
  };
}