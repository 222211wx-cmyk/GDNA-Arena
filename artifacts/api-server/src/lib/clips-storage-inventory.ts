import type { ClipReference, InventoryObject } from "./clips-storage-reconciliation.js";

export interface InventoryPage {
  objects: InventoryObject[];
  nextPageToken?: string;
}

/** No partial report may escape a failed/truncated enumeration. */
export async function collectClipInventory(
  page: (token?: string) => Promise<InventoryPage>,
  maxObjects = 100_000,
): Promise<InventoryObject[]> {
  if (!Number.isSafeInteger(maxObjects) || maxObjects < 1) throw new Error("Invalid max-objects");
  const objects: InventoryObject[] = [];
  const tokens = new Set<string>();
  let token: string | undefined;
  do {
    const result = await page(token);
    objects.push(...result.objects);
    if (objects.length > maxObjects) throw new Error("Inventory exceeds max-objects; no report produced");
    token = result.nextPageToken;
    if (token && tokens.has(token)) throw new Error("Repeated storage page token; no report produced");
    if (token) tokens.add(token);
  } while (token);
  return objects;
}

interface ReadClient {
  query(sql: string): Promise<{ rows: any[] }>;
}

/** Read every clip, not only public/unfrozen or retry-eligible rows. No DDL. */
export async function readClipReferences(client: ReadClient) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL statement_timeout = '30s'");
    const clips = await client.query("SELECT id, object_name, thumbnail_object_name, upload_object_name, processing_output_object FROM clips");
    const queue = await client.query("SELECT object_name FROM clip_storage_cleanup");
    await client.query("COMMIT");
    return {
      clips: clips.rows as ClipReference[],
      queuedNames: queue.rows.map(row => row.object_name as string),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
