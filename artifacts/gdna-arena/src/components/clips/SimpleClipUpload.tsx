import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Input } from "@workspace/gdna-ds/components/ui/input";
import { Label } from "@workspace/gdna-ds/components/ui/label";
import { Progress } from "@workspace/gdna-ds/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@workspace/gdna-ds/components/ui/radio-group";

const MAX_BYTES = 20 * 1024 * 1024;
const BASE = import.meta.env.BASE_URL;

export function SimpleClipUpload({ onPublished }: { onPublished: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [purpose, setPurpose] = useState<"story" | "original">("story");
  const [originalReference, setOriginalReference] = useState("");
  const [rightsHolderName, setRightsHolderName] = useState("");
  const [rightsHolderRole, setRightsHolderRole] = useState<"owner" | "producer">("owner");
  const [receipt, setReceipt] = useState<{ id: number; registeredAt: string; holder: string; role: string } | null>(null);
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
    if (purpose === "original" && originalReference.trim().length < 3) {
      setError("أدخل مرجع تسجيل الأصل أو وثيقة حقوقه");
      return;
    }
    if (purpose === "original" && rightsHolderName.trim().length < 2) {
      setError("أدخل اسم صاحب الحقوق أو المنتج المخوّل");
      return;
    }
    setBusy(true);
    setError("");
    setDone(false);
    setReceipt(null);
    setSaving(false);
    setProgress(0);
    const body = new FormData();
    body.append("file", file);
    body.append("purpose", purpose);
    if (purpose === "original") {
      body.append("originalReference", originalReference.trim());
      body.append("rightsHolderName", rightsHolderName.trim());
      body.append("rightsHolderRole", rightsHolderRole);
    }
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
      const rights = data.clip?.rights;
      if (rights?.purpose === "original" && Number.isSafeInteger(rights.registrationId) &&
          typeof rights.registeredAt === "string" && Number.isFinite(Date.parse(rights.registeredAt))) {
        setReceipt({
          id: rights.registrationId, registeredAt: rights.registeredAt,
          holder: typeof rights.rightsHolderName === "string" ? rights.rightsHolderName : rightsHolderName.trim(),
          role: rights.rightsHolderRole === "producer" ? "منتج مخوّل" : "صاحب العمل",
        });
      }
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
           setReceipt(null);
        }} />
      <fieldset disabled={busy} className="space-y-2">
        <legend className="text-sm text-foreground">نوع النشر</legend>
        <RadioGroup value={purpose} disabled={busy} dir="rtl" aria-label="نوع النشر"
          onValueChange={value => { setPurpose(value as "story" | "original"); setError(""); setDone(false); setReceipt(null); }}>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="clip-purpose-story" value="story" />
            <Label htmlFor="clip-purpose-story">ستوري / مقطع مواطن</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="clip-purpose-original" value="original" />
            <Label htmlFor="clip-purpose-original">إيداع أصل لديّ حقوقه</Label>
          </div>
        </RadioGroup>
        {purpose === "original" ? <div className="space-y-2">
          <Label htmlFor="clip-rights-holder">اسم صاحب الحقوق أو المنتج المخوّل</Label>
          <Input id="clip-rights-holder" value={rightsHolderName} required minLength={2} maxLength={120}
            placeholder="الاسم الذي يُسجّل العمل باسمه" disabled={busy}
            onChange={event => { setRightsHolderName(event.target.value); setError(""); }} />
          <RadioGroup value={rightsHolderRole} disabled={busy} dir="rtl" aria-label="صفة صاحب الحقوق"
            onValueChange={value => setRightsHolderRole(value as "owner" | "producer")}>
            <div className="flex items-center gap-2">
              <RadioGroupItem id="clip-holder-owner" value="owner" />
              <Label htmlFor="clip-holder-owner">صاحب العمل</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem id="clip-holder-producer" value="producer" />
              <Label htmlFor="clip-holder-producer">منتج مخوّل</Label>
            </div>
          </RadioGroup>
          <Label htmlFor="clip-original-reference">مرجع تسجيل الأصل أو وثيقة الحقوق</Label>
          <Input id="clip-original-reference" value={originalReference} required minLength={3} maxLength={200}
            placeholder="رقم التسجيل أو مرجع الوثيقة" disabled={busy}
            onChange={event => { setOriginalReference(event.target.value); setError(""); }} />
          <p className="text-sm text-muted-foreground">
            باختيار هذا النوع تصرّح بأنك صاحب الحقوق أو مخوّل بالإيداع نيابةً عنه. يُحفظ الاسم والمرجع وتاريخ الإيداع؛ هذا توثيق داخل المنصة، وليس تحققاً قانونياً من الملكية.
          </p>
        </div> : <p className="text-sm text-muted-foreground">
          تشابه الموسيقى وحده لا يمنع النشر. لا تُعد نشر فيديو مطابق لمدّة وصور أصل مودَع. تبقى تراخيص الاستخدام مسؤولية الناشر.
        </p>}
      </fieldset>
      <Button type="submit" disabled={!file || busy}>{busy ? "جارٍ الرفع…" : error && file ? "إعادة المحاولة" : "نشر"}</Button>
      {(busy || done) && <div role="status" aria-live="polite">
        <Progress value={progress} aria-label="تقدم الرفع" />
        <p>{progress}%{saving ? " — جارٍ حفظ الملف…" : done ? " — تم النشر" : ""}</p>
      </div>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
       {receipt && <p className="text-sm text-muted-foreground" data-testid="clip-original-receipt">
         تم إيداع الأصل برقم {receipt.id} باسم {receipt.holder} ({receipt.role}) بتاريخ <time dateTime={receipt.registeredAt}>{new Date(receipt.registeredAt).toLocaleString("ar")}</time> — تصريح بالحقوق، غير محقّق قانونياً.
       </p>}
    </form>
  );
}