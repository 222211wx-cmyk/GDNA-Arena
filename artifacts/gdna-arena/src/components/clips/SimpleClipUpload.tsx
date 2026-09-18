import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Input } from "@workspace/gdna-ds/components/ui/input";
import { Label } from "@workspace/gdna-ds/components/ui/label";
import { Progress } from "@workspace/gdna-ds/components/ui/progress";

const MAX_BYTES = 20 * 1024 * 1024;
const BASE = import.meta.env.BASE_URL;

export function SimpleClipUpload({ onPublished }: { onPublished: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<XMLHttpRequest | null>(null);

  useEffect(() => () => {
    const xhr = request.current;
    if (xhr) {
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
      xhr.upload.onprogress = xhr.upload.onload = null;
      xhr.abort();
    }
  }, []);

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    if (file.size > MAX_BYTES) { setError(file.type.startsWith("audio/") ? "صغر الملف الصوتي" : "صغر الفيديو"); return; }
    setBusy(true);
    setError("");
    setDone(false);
    setSaving(false);
    setProgress(0);
    const body = new FormData();
    body.append("file", file);
    const xhr = new XMLHttpRequest();
    request.current = xhr;
    xhr.open("POST", `${BASE}api/clip/upload`);
    xhr.withCredentials = true;
    xhr.timeout = 300_000;
    const fail = (message: string) => {
      setBusy(false);
      setSaving(false);
      setError(message);
      request.current = null;
    };
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) setProgress(Math.min(99, Math.round(event.loaded / event.total * 100)));
    };
    xhr.upload.onload = () => setSaving(true);
    xhr.onerror = () => fail("فشل الاتصال — حاول مجدداً");
    xhr.ontimeout = () => fail("انتهت مهلة الرفع — حاول مجدداً");
    xhr.onabort = () => fail("تم إلغاء الرفع");
    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { fail("تعذر رفع الملف — حاول مجدداً"); return; }
      if (xhr.status < 200 || xhr.status >= 300 || data?.ok !== true || typeof data.url !== "string") {
        fail(typeof data?.error === "string" ? data.error : "تعذر رفع الملف — حاول مجدداً");
        return;
      }
      request.current = null;
      setBusy(false);
      setSaving(false);
      setProgress(100);
      setDone(true);
      setFile(null);
      if (input.current) input.current.value = "";
      onPublished();
    };
    xhr.send(body);
  }

  return (
    <form onSubmit={upload} className="mb-4 space-y-3" dir="rtl" data-testid="clips-upload">
      <Label htmlFor="clip-upload-file">رفع صوت أو فيديو — 20 MB كحد أقصى</Label>
      <p className="text-sm text-muted-foreground">الفيديو: دقيقة واحدة على الأقل. يمكن رفع مقاطع صوتية قصيرة. تُرفع الملفات الأصلية دون ضغط.</p>
      <Input ref={input} id="clip-upload-file" type="file" accept="video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/wav,audio/x-wav,audio/webm,audio/flac,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac" disabled={busy}
        onChange={event => {
          const selected = event.target.files?.[0] ?? null;
          const oversized = !!selected && selected.size > MAX_BYTES;
          setFile(oversized ? null : selected);
          setError(oversized ? selected.type.startsWith("audio/") ? "صغر الملف الصوتي" : "صغر الفيديو" : "");
          setProgress(0);
          setDone(false);
        }} />
      <Button type="submit" disabled={!file || busy}>{busy ? "جارٍ الرفع…" : error && file ? "إعادة المحاولة" : "نشر"}</Button>
      {(busy || done) && <div role="status" aria-live="polite">
        <Progress value={progress} aria-label="تقدم الرفع" />
        <p>{progress}%{saving ? " — جارٍ حفظ الملف…" : done ? " — تم النشر" : ""}</p>
      </div>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </form>
  );
}