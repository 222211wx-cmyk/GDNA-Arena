// Chat attachment storage on Replit App Storage (GCS-backed).
// Local disk does NOT survive production republishes — all chat media is
// persisted in the bucket under `${PRIVATE_OBJECT_DIR}/chat/<name>`.
import { Readable } from "stream";
import { Storage, type File } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/");
  if (parts.length < 3) throw new Error("Invalid object path");
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

function chatObjectFile(name: string): File {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set — provision App Storage");
  const { bucketName, objectName } = parseObjectPath(`${dir.replace(/\/$/, "")}/chat/${name}`);
  return objectStorageClient.bucket(bucketName).file(objectName);
}

/** Upload one chat attachment buffer to the bucket (used by legacy migration). */
export async function saveChatObject(name: string, buffer: Buffer, contentType: string): Promise<void> {
  await chatObjectFile(name).save(buffer, {
    resumable: false,
    metadata: { contentType },
  });
}

/**
 * Multer storage engine that STREAMS each upload straight into the bucket —
 * nothing is buffered in Node memory or written to local disk, so large
 * concurrent uploads cannot OOM the API process.
 * The stored filename/extension is ALWAYS server-chosen via `chooseName`.
 */
export function gcsChatStorage(chooseName: (mimetype: string) => string): import("multer").StorageEngine {
  return {
    _handleFile(_req, file, cb) {
      let filename: string;
      let gcsFile: File;
      try {
        filename = chooseName(file.mimetype);
        gcsFile = chatObjectFile(filename);
      } catch (e) { cb(e as Error); return; }
      let size = 0;
      file.stream.on("data", (chunk: Buffer) => { size += chunk.length; });
      const ws = gcsFile.createWriteStream({
        resumable: false,
        metadata: { contentType: file.mimetype },
      });
      ws.on("error", (e) => cb(e));
      ws.on("finish", () => cb(null, { filename, size } as Partial<Express.Multer.File>));
      file.stream.on("error", (e) => { ws.destroy(e); cb(e); });
      file.stream.pipe(ws);
    },
    _removeFile(_req, file, cb) {
      // Called by multer on error/abort (e.g. size limit hit mid-stream) —
      // remove the partial object so no oversized/orphaned data persists.
      if (!file.filename) { cb(null); return; }
      chatObjectFile(file.filename).delete({ ignoreNotFound: true })
        .then(() => cb(null), (e) => cb(e));
    },
  };
}

/** Returns the GCS file handle if the attachment exists, else null. */
export async function getChatObject(name: string): Promise<File | null> {
  const file = chatObjectFile(name);
  const [exists] = await file.exists();
  return exists ? file : null;
}

/** Stream a GCS file into an Express response (headers must be set by caller). */
export function chatObjectStream(file: File): Readable {
  return file.createReadStream();
}

/**
 * Idempotent startup migration: copy any legacy chat attachments still on
 * local disk (`uploads/chat/`) into the bucket. Safe to run on every boot —
 * objects already in the bucket are skipped. This rescues pre-migration files
 * in any environment where the disk copy still exists.
 */
export async function migrateLegacyChatUploads(
  legacyDir: string,
  mimeForExt: (ext: string) => string,
): Promise<void> {
  const fs = await import("fs");
  const path = await import("path");
  if (!fs.existsSync(legacyDir)) return;
  let migrated = 0, skipped = 0, failed = 0;
  for (const name of fs.readdirSync(legacyDir)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
    try {
      if (await getChatObject(name)) { skipped++; continue; }
      const buf = fs.readFileSync(path.join(legacyDir, name));
      await saveChatObject(name, buf, mimeForExt(path.extname(name).toLowerCase()));
      migrated++;
    } catch (e) {
      failed++;
      console.error(`Legacy chat upload migration failed for ${name}:`, e);
    }
  }
  if (migrated || failed) {
    console.log(`Chat attachment migration: ${migrated} migrated, ${skipped} already in bucket, ${failed} failed`);
  }
}
