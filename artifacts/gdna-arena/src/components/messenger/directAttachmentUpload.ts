export async function directAttachmentUpload(
  endpoint: string, blob: Blob, signal: AbortSignal, progress: (value: number) => void,
): Promise<{ url: string }> {
  async function metadata(body: unknown, requestSignal?: AbortSignal) {
    const response = await fetch(endpoint, { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: requestSignal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "تعذر رفع الملف — حاول مرة أخرى");
    return data;
  }
  let ticket: string | undefined;
  try {
    const upload = await metadata({ action: "start", size: blob.size }, signal);
    ticket = upload.ticket;
    if (!ticket || !Array.isArray(upload.urls) || upload.chunkSize !== 5 * 1024 * 1024) throw new Error("Invalid upload response");
    for (let i = 0; i < upload.urls.length; i++) {
      const chunk = blob.slice(i * upload.chunkSize, (i + 1) * upload.chunkSize);
      let done = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(upload.urls[i], { method: "PUT", body: chunk, signal, credentials: "omit" });
          if (!response.ok) throw new Error("تعذر رفع الملف إلى التخزين");
          done = true; break;
        } catch (error) { if (signal.aborted || attempt === 2) throw error; }
      }
      if (!done) throw new Error("Upload failed");
      progress(Math.round(Math.min(blob.size, (i + 1) * upload.chunkSize) / blob.size * 100));
    }
    return await metadata({ action: "complete", ticket }, signal);
  } catch (error) {
    if (ticket) void metadata({ action: "abort", ticket }).catch(() => {});
    throw error;
  }
}