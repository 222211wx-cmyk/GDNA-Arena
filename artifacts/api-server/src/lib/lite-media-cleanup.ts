import type { PoolClient } from "pg";

/** Call inside the clip/account deletion transaction, after its compression lock. */
export async function enqueueLiteMediaDeletion(client: PoolClient, clipId: number) {
  await client.query(`INSERT INTO clip_storage_cleanup(object_name,clip_id)
    SELECT name,clip_id FROM clip_lite_media CROSS JOIN LATERAL
    unnest(ARRAY[output_object,mirror_object]) AS name
    WHERE clip_id=$1 AND name IS NOT NULL
    ON CONFLICT(object_name) DO UPDATE SET retry_at=now()`, [clipId]);
}