import type { File } from "@google-cloud/storage";
import type { ApprovedCleanupStorage } from "./clip-approved-cleanup.js";
import type { ExactObject } from "./clip-cleanup-approval.js";

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("STORAGE_TIMEOUT")), 15_000); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export function approvedCleanupStorage(root: File): ApprovedCleanupStorage {
  return {
    async verifyOwner(owner) {
      if (owner.bucket !== root.bucket.name || owner.prefix !== root.name) throw new Error("BUCKET_SCOPE_MISMATCH");
      const marker = root.bucket.file(owner.marker_name);
      const [metadata] = await bounded(marker.getMetadata());
      if (String(metadata.generation) !== owner.marker_generation ||
          !/^[1-9]\d*$/.test(String(metadata.size)) || BigInt(String(metadata.size)) > 4096n) throw new Error("OWNERSHIP_MARKER_CHANGED");
      // Pin the download as well; replacement between metadata/read cannot
      // supply a marker from a different environment.
      const [bytes] = await bounded(root.bucket.file(owner.marker_name, { generation: owner.marker_generation }).download());
      if (bytes.length > 4096) throw new Error("OWNERSHIP_MARKER_TOO_LARGE");
      const markerValue = JSON.parse(bytes.toString("utf8"));
      if (markerValue.databaseId !== owner.database_id || markerValue.databaseName !== owner.database_name ||
          markerValue.bucket !== owner.bucket || markerValue.prefix !== owner.prefix) throw new Error("OWNERSHIP_MARKER_MISMATCH");
    },
    async metadata(name) {
      try {
        const [metadata] = await bounded(root.bucket.file(root.name + name).getMetadata());
        return {
          name, generation: String(metadata.generation), metageneration: String(metadata.metageneration),
          size: String(metadata.size), timeCreated: metadata.timeCreated ?? "", updated: metadata.updated ?? "",
        };
      } catch (error) {
        if (String((error as { code?: unknown }).code) === "404") return null;
        throw error;
      }
    },
    async deleteExact(object: ExactObject) {
      // Preconditions belong on the File instance in @google-cloud/storage,
      // not the delete() options. Strings preserve 64-bit generation precision.
      const file = root.bucket.file(root.name + object.name, {
        preconditionOpts: {
          ifGenerationMatch: object.generation,
          ifMetagenerationMatch: object.metageneration,
        },
      });
      // No generation selector: act only on the currently live approved version.
      // Never fall back to an unconditional name deletion after a 412.
      await bounded(file.delete({ ignoreNotFound: true }));
    },
  };
}