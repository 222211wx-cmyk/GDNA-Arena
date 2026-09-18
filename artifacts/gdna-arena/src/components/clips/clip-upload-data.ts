export const CLIP_CHUNK_SIZE = 5 * 1024 * 1024;
export const MAX_CLIP_BYTES = 2 * 1024 * 1024 * 1024;

/** Separate tus resources, not the optional tus concatenation extension. */
export function clipPartRanges(size: number): { start: number; end: number }[] {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_CLIP_BYTES) {
    throw new Error("Invalid clip size");
  }
  const count = Math.min(3, Math.ceil(size / CLIP_CHUNK_SIZE));
  const width = Math.ceil(size / count);
  return Array.from({ length: count }, (_, index) => ({
    start: index * width,
    end: Math.min(size, (index + 1) * width),
  }));
}

export function clipProgress(offsets: number[], sizes: number[]) {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const bytes = sizes.reduce((sum, size, index) => sum + Math.max(0, Math.min(size, offsets[index] || 0)), 0);
  return { bytes, total, percent: total ? Math.floor((bytes / total) * 100) : 0 };
}

export function clipResumeKey(userId: number | string, groupId: string, partIndex: number) {
  return JSON.stringify(["clip-upload-v1", String(userId), groupId, partIndex]);
}

export interface ClipUploadDraft {
  userId: string;
  groupId: string;
  file: File;
  title: string;
  duration: number;
  thumbnail: Blob | null;
  prepared: boolean;
  compress: boolean;
  urls: (string | null)[];
  completed: boolean[];
  createdAt: number;
}

function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("gdna-clip-upload-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "userId" });
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Draft storage is blocked"));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function readClipDraft(userId: string): Promise<ClipUploadDraft | null> {
  const database = await openDraftDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction("drafts", "readonly").objectStore("drafts").get(userId);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function writeClipDraft(userId: string, draft: ClipUploadDraft | null): Promise<void> {
  const database = await openDraftDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      const store = transaction.objectStore("drafts");
      if (draft) store.put(draft);
      else store.delete(userId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}