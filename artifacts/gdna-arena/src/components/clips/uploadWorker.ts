import { currentUploadOwner, pauseQueuedUpload, runQueuedUpload } from "./clipUpload";
import { listQueue } from "./uploadQueue";

// Bundled into the existing canonical sw.js; never a second registration.
type WorkerEvent = Event & { data?: { type?: string; id?: string }; tag?: string; waitUntil(promise: Promise<unknown>): void };
const worker = globalThis as unknown as {
  addEventListener(type: string, listener: (event: WorkerEvent) => void): void;
  clients: { matchAll(options: { type: string; includeUncontrolled: boolean }): Promise<{ postMessage(value: unknown): void }[]> };
};
async function broadcast(message: unknown) {
  for (const client of await worker.clients.matchAll({ type: "window", includeUncontrolled: true })) client.postMessage(message);
}
async function resume(id?: string) {
  const owner = await currentUploadOwner();
  const records = await listQueue(owner);
  for (const record of records) {
    if (id && record.id !== id) continue;
    if (record.status === "paused" || record.status === "published" || record.serverOwned) continue;
    // Native encoding needs a visible document; never bypass it from Sync.
    if (record.preparation === "pending") continue;
    try {
      const receipt = await runQueuedUpload(record.id, owner, new AbortController().signal, (percent, uploaded, speed, state) => {
        void broadcast({ type: "CLIP_UPLOAD_PROGRESS", id: record.id, owner, percent, uploaded, speed, state });
      }, false);
      if (!receipt) continue;
      await broadcast({ type: "CLIP_UPLOAD_DONE", id: record.id, owner, receipt });
    } catch (error) {
      await broadcast({ type: "CLIP_UPLOAD_ERROR", id: record.id, owner, error: error instanceof Error ? error.message : "Transfert interrompu" });
      // Reject Sync work so the browser can retry; paused work is excluded above.
      throw error;
    }
  }
}
worker.addEventListener("sync", event => {
  if (event.tag === "helixly-clips-upload") event.waitUntil(resume());
});
worker.addEventListener("message", event => {
  if (event.data?.type === "CLIP_UPLOAD_START") event.waitUntil(resume(event.data.id));
  if (event.data?.type === "CLIP_UPLOAD_PAUSE" && event.data.id) pauseQueuedUpload(event.data.id);
});