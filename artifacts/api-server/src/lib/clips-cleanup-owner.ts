import type { PoolClient } from "pg";
import type { StorageOwner } from "./clip-cleanup-approval.js";

export async function readStorageOwner(client: PoolClient): Promise<StorageOwner> {
  const guard = await client.query(
    `SELECT 1 FROM pg_trigger
     WHERE tgrelid='public.clips'::regclass AND tgname='clips_reject_orphan_tombstone'
       AND tgenabled='A' AND NOT tgisinternal
       AND tgfoid='public.reject_clip_orphan_tombstone()'::regprocedure`,
  );
  if (guard.rows.length !== 1) throw new Error("PUBLICATION_GUARD_NOT_INSTALLED");
  const result = await client.query<StorageOwner & { actual_database: string }>(
    `SELECT *, current_database() AS actual_database FROM clip_storage_owner WHERE singleton = TRUE FOR SHARE`,
  );
  const owner = result.rows[0];
  if (result.rows.length !== 1 || owner.database_name !== owner.actual_database ||
      !owner.bucket || !owner.prefix.endsWith("/clips/") || owner.prefix.startsWith("/") ||
      owner.prefix.split("/").some(part => part === "." || part === "..") ||
      !owner.marker_name || owner.marker_name.startsWith(owner.prefix) ||
      !/^[1-9]\d*$/.test(owner.marker_generation)) throw new Error("UNVERIFIED_DATABASE_OWNERSHIP");
  return owner;
}

/** Optional for read-only reports; an unbound report can never authorize cleanup. */
export async function reportOwnership(client: PoolClient) {
  const exists = await client.query("SELECT to_regclass('clip_storage_owner') AS owner_table");
  if (!exists.rows[0]?.owner_table) return null;
  // Reports use a read-only connection and therefore must not acquire row locks.
  const result = await client.query<StorageOwner & { actual_database: string }>(
    "SELECT *, current_database() AS actual_database FROM clip_storage_owner WHERE singleton = TRUE",
  );
  const owner = result.rows[0];
  if (!owner || owner.database_name !== owner.actual_database) return null;
  return { databaseId: owner.database_id, databaseName: owner.database_name, markerGeneration: owner.marker_generation };
}
