import type { ClipUploadMetadata } from "./clipUpload";

export type QueueRecord = {
  id: string;
  owner: number;
  name: string;
  size: number;
  metadata: ClipUploadMetadata;
  requestId: string;
  sessionId?: string;
  completed: [number, string][];
  status: "pending" | "uploading" | "paused" | "processing" | "published" | "error" | "failed";
  serverOwned?: boolean;
  uploaded: number;
  error?: string;
  preparation?: "pending" | "compressed" | "original";
  preparationMessage?: string;
  originalFingerprint?: string;
  transformedFingerprint?: string;
  originalSize?: number;
};
const DATABASE = "helixly-clips-uploads-v1";
export const lockName = (id: string) => `helixly-clip:${id}`;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB indisponible"));
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("records", { keyPath: "id" });
      request.result.createObjectStore("files");
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Stockage local bloqué"));
    request.onsuccess = () => resolve(request.result);
  });
}

async function transaction<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let value: T;
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Échec du stockage local")); };
    try { work(tx, result => { value = result; }); }
    catch (error) { tx.abort(); db.close(); reject(error); }
  });
}

export async function enqueueFile(file: File, metadata: ClipUploadMetadata, owner: number, prepare = false): Promise<QueueRecord> {
  if (!navigator.locks) throw new Error("Verrouillage multi-onglets indisponible");
  const id = crypto.randomUUID();
  const record: QueueRecord = { id, owner, name: file.name, size: file.size, metadata, requestId: id, completed: [], status: "pending", uploaded: 0, ...(prepare ? { preparation: "pending" as const, originalSize: file.size } : {}) };
  // Structured clone stores the actual bytes, never an unsafe partial fingerprint.
  // Transaction completion, not request success, establishes durability.
  await transaction<void>(["records", "files"], "readwrite", tx => {
    tx.objectStore("files").put(file, id);
    tx.objectStore("records").put(record);
  });
  return record;
}

/** SHA-256 tree fingerprint over every byte, with bounded 5 MiB hash buffers.
 * Versioned deliberately: this is not a conventional whole-file SHA-256. */
export async function fingerprint(file: Blob, signal: AbortSignal): Promise<string> {
  const hashes: Uint8Array[] = [];
  for (let offset = 0; offset < file.size; offset += 5 * 1024 * 1024) {
    signal.throwIfAborted();
    hashes.push(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.slice(offset, offset + 5 * 1024 * 1024).arrayBuffer())));
  }
  signal.throwIfAborted();
  const manifest = new Uint8Array(hashes.length * 32);
  hashes.forEach((hash, index) => manifest.set(hash, index * 32));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", manifest));
  return `sha256-tree-5m-v1:${file.size}:${Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Commit the transformed bytes and identity BEFORE any multipart initiation.
 * Keep the original separately until server acceptance; interrupted preparation
 * can resume from the durable source, while retries reuse the finished output. */
export async function storePreparedFile(record: QueueRecord, original: File, prepared: File, signal: AbortSignal) {
  record.originalFingerprint = await fingerprint(original, signal);
  record.transformedFingerprint = prepared === original ? record.originalFingerprint : await fingerprint(prepared, signal);
  signal.throwIfAborted();
  await transaction<void>(["records", "files"], "readwrite", tx => {
    tx.objectStore("files").put(original, `${record.id}:original`);
    tx.objectStore("files").put(prepared, record.id);
    tx.objectStore("records").put(record);
  });
}

export async function listQueue(owner: number): Promise<QueueRecord[]> {
  return transaction(["records"], "readonly", (tx, result) => {
    const request = tx.objectStore("records").getAll();
    request.onsuccess = () => result((request.result as QueueRecord[]).filter(item => item.owner === owner));
  });
}

export async function readQueue(id: string, owner: number): Promise<{ record: QueueRecord; file?: File }> {
  return transaction(["records", "files"], "readonly", (tx, result) => {
    const request = tx.objectStore("records").get(id);
    request.onsuccess = () => {
      const record: QueueRecord | undefined = request.result;
      if (!record || record.owner !== owner) { tx.abort(); return; }
      if (record.serverOwned) { result({ record }); return; }
      const bytes = tx.objectStore("files").get(id);
      bytes.onsuccess = () => {
        if (!(bytes.result instanceof Blob)) { tx.abort(); return; }
        result({ record, file: new File([bytes.result], record.name, { type: record.metadata.contentType }) });
      };
    };
  });
}

/** Atomically retain the account-scoped job and release original bytes only after acceptance. */
export async function storeProcessingJob(record: QueueRecord) {
  await transaction<void>(["records", "files"], "readwrite", tx => {
    tx.objectStore("records").put({ ...record, serverOwned: true, status: "processing", uploaded: record.size });
    tx.objectStore("files").delete(record.id);
    tx.objectStore("files").delete(`${record.id}:original`);
  });
}

export async function saveQueue(record: QueueRecord) {
  await transaction<void>(["records"], "readwrite", tx => {
    const store = tx.objectStore("records");
    const request = store.get(record.id);
    request.onsuccess = () => {
      // A removed record must never be resurrected by a late acknowledgement.
      if (!request.result || request.result.owner !== record.owner) { tx.abort(); return; }
      store.put(record);
    };
  });
}

export async function removeQueue(id: string, owner: number) {
  await transaction<void>(["records", "files"], "readwrite", tx => {
    const store = tx.objectStore("records");
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result?.owner !== owner) { tx.abort(); return; }
      store.delete(id);
      tx.objectStore("files").delete(id);
      tx.objectStore("files").delete(`${id}:original`);
    };
  });
}