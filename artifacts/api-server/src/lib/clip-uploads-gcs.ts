import { pool } from "@workspace/db";
import { AsyncLocalStorage } from "node:async_hooks";
import { clipFile, publishClip, type ClipDatabaseClient } from "./clip-publish.js";
import { ClipUploadError } from "./clip-upload-protocol.js";
import { clipWithThumbnail } from "../routes/clips-thumbnail-response.js";
import type { UploadPublisher, UploadStore, Versioned } from "./clip-uploads.js";

function storageError(error: unknown): never {
  if (Number((error as { code?: number }).code) === 412) throw new ClipUploadError(409, "Upload changed concurrently; resume with HEAD");
  throw error;
}

/** All paths are server-generated beneath PRIVATE_OBJECT_DIR, never public ACLs. */
export const gcsUploadStore: UploadStore = {
  async read<T>(name: string): Promise<Versioned<T> | null> {
    const file = clipFile(name);
    // Pin the download to the metadata generation; never pair stale JSON with a
    // newer CAS token. A concurrent replace without object-version retention can
    // make that generation disappear, in which case retry the latest snapshot.
    for (let attempt = 0; attempt < 5; attempt++) {
      let generation: string;
      try {
        const [metadata] = await file.getMetadata();
        generation = String(metadata.generation);
      } catch (error) {
        if (Number((error as { code?: number }).code) === 404) return null;
        throw error;
      }
      try {
        const [bytes] = await file.bucket.file(file.name, { generation }).download();
        return { value: JSON.parse(bytes.toString("utf8")) as T, generation };
      } catch (error) {
        if (Number((error as { code?: number }).code) === 404) continue;
        throw error;
      }
    }
    throw new ClipUploadError(409, "Upload changed concurrently; retry");
  },
  async write(name, value, generation) {
    try {
      await clipFile(name).save(JSON.stringify(value), {
        resumable: false,
        preconditionOpts: { ifGenerationMatch: generation },
        metadata: { contentType: "application/json", cacheControl: "private, no-store" },
      });
    } catch (error) { storageError(error); }
  },
  async put(name, bytes, contentType) {
    await clipFile(name).save(bytes, {
      resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType, cacheControl: "private, no-store" },
    });
  },
  async remove(name) { await clipFile(name).delete({ ignoreNotFound: true }); },
  async compose(sources, target, contentType) {
    const destination = clipFile(target);
    // SDK Bucket.combine takes destination.metadata.contentType (not an option).
    destination.metadata.contentType = contentType;
    try {
      await destination.bucket.combine(sources.map(name => clipFile(name)), destination, { ifGenerationMatch: 0 });
    } catch (error) {
      // Sources and intermediate names are immutable, and a group advisory lock
      // serializes finalization. A previous successful compose is reusable.
      if (Number((error as { code?: number }).code) !== 412) throw error;
    }
  },
  stream(name) { return clipFile(name).createReadStream(); },
};

// A finalization must reuse its advisory-lock connection for DB work. Taking
// a second pool connection could deadlock when concurrent groups fill the pool.
const groupConnection = new AsyncLocalStorage<ClipDatabaseClient>();
export const clipUploadPublisher: UploadPublisher = {
  async lock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const client = await pool.connect();
    let locked = false;
    let broken: Error | undefined;
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [key]);
      locked = true;
      return await groupConnection.run(client, action);
    } finally {
      if (locked) {
        try { await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]); }
        catch (error) { broken = error as Error; }
      }
      client.release(broken);
    }
  },
  async find(userId, objectName) {
    const { rows } = await (groupConnection.getStore() ?? pool).query(
      `SELECT c.id, c.title, c.duration_sec, c.created_at, c.thumbnail_object_name,
              CASE WHEN r.id IS NULL THEN 'story' ELSE 'original' END AS rights_purpose,
              r.id AS rights_registration_id, r.created_at AS rights_registered_at,
              r.rights_holder_name, r.rights_holder_role
       FROM clips c JOIN content_fingerprints f ON f.content_id=c.id AND f.content_type='clip'
       LEFT JOIN clip_original_registrations r ON r.clip_id=c.id
       WHERE c.user_id=$1 AND c.object_name=$2 LIMIT 1`, [userId, objectName]);
    if (!rows[0]) return null;
    const row = rows[0];
    const {
      rights_purpose: rightsPurpose,
      rights_registration_id: registrationId,
      rights_registered_at: registeredAt,
      rights_holder_name: rightsHolderName,
      rights_holder_role: rightsHolderRole,
      ...publicRow
    } = row;
    return {
      ...clipWithThumbnail(publicRow),
      rights: rightsPurpose === "original"
        ? {
            purpose: "original",
            registrationId,
            registeredAt,
            rightsHolderName,
            rightsHolderRole,
            status: "declared",
          }
        : { purpose: "story" },
    };
  },
  publish: input => publishClip(input, groupConnection.getStore()),
};