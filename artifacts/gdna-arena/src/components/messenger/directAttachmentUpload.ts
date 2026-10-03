export async function directAttachmentUpload(
  endpoint: string, blob: Blob, signal: AbortSignal, progress: (value: number) => void,
): Promise<{ url: string }> {
  async function metadata(body: unknown) {
    const response = await fetch(endpoint, { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "تعذر رفع الملف — حاول مرة أخرى");
    return data;
  }
  const upload = await metadata({ action: "start", size: blob.size });
  if (typeof upload.url !== "string" || typeof upload.ticket !== "string") throw new Error("Invalid upload response");
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    };
    xhr.open("PUT", upload.url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("If-None-Match", "*");
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.floor(event.loaded / event.total * 100)); };
    xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? undefined : new Error("تعذر رفع الملف"));
    xhr.onerror = () => finish(new Error("تعذر الاتصال لرفع الملف؛ حاول مرة أخرى"));
    xhr.onabort = () => finish(new DOMException("Cancelled", "AbortError"));
    if (signal.aborted) { finish(new DOMException("Cancelled", "AbortError")); return; }
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(blob);
  });
  return metadata({ action: "complete", ticket: upload.ticket });
}