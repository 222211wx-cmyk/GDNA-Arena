import type { PoolClient } from "pg";
import { ClipUploadError } from "./clip-upload-protocol.js";
import { retryThumbnailName } from "./clip-storage-names.js";

/**
 * Called only inside the authenticated account-erasure transaction. Preserve
 * finance/rights history, but durably remove both playback and retained source
 * bytes belonging to this account once its clip rows have been deleted.
 */
export async function deleteAccountClips(client: PoolClient, userId: number): Promise<void> {
  const { rows } = await client.query<{
    id: number; object_name: string; upload_object_name: string | null;
    thumbnail_object_name: string | null; processing_output_object: string | null;
  }>(
    `SELECT id, object_name, upload_object_name, thumbnail_object_name, processing_output_object
     FROM clips WHERE user_id=$1 ORDER BY id FOR UPDATE`, [userId],
  );
  for (const clip of rows) {
    const lock = await client.query(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired",
      [`clip-compression:${clip.id}`],
    );
    if (lock.rows[0]?.acquired !== true) {
      throw new ClipUploadError(409, "A clip is processing; retry account deletion after processing finishes");
    }
    const names = [...new Set([
      clip.object_name, clip.upload_object_name, clip.thumbnail_object_name,
      clip.processing_output_object, retryThumbnailName(clip.id, clip.object_name),
    ].filter((name): name is string => !!name))];
    await client.query(
      `INSERT INTO clip_storage_cleanup (object_name, clip_id)
       SELECT name,$1 FROM unnest($2::text[]) AS name
       ON CONFLICT (object_name) DO UPDATE SET retry_at=NOW()`, [clip.id, names],
    );
    await client.query("DELETE FROM clip_views WHERE clip_id=$1", [clip.id]);
    await client.query("DELETE FROM clips WHERE id=$1 AND user_id=$2", [clip.id, userId]);
  }
}