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

export async function enqueueFile(file: File, metadata: ClipUploadMetadata, owner: number): Promise<QueueRecord> {
  if (!navigator.locks) throw new Error("Verrouillage multi-onglets indisponible");
  const id = crypto.randomUUID();
  const record: QueueRecord = { id, owner, name: file.name, size: file.size, metadata, requestId: id, completed: [], status: "pending", uploaded: 0 };
  // Structured clone stores the actual bytes, never an unsafe partial fingerprint.
  // Transaction completion, not request success, establishes durability.
  await transaction<void>(["records", "files"], "readwrite", tx => {
    tx.objectStore("files").put(file, id);
    tx.objectStore("records").put(record);
  });
  return record;
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
    };
  });
}