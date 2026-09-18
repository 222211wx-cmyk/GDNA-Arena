import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Checkbox } from "@workspace/gdna-ds/components/ui/checkbox";
import { Input } from "@workspace/gdna-ds/components/ui/input";
import { Label } from "@workspace/gdna-ds/components/ui/label";
import { Progress } from "@workspace/gdna-ds/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@workspace/gdna-ds/components/ui/radio-group";
import { mediaDuration, prepareVideo, VideoPreparationUnsupportedError } from "./prepareVideo";
import { uploadClip, type ClipUploadMetadata } from "./clipUpload";

const MAX_BYTES = 2 * 1024 * 1024 * 1024;

type Receipt = { id: number; registeredAt: string; holder: string; role: string };

export function ResumableClipUpload({ onPublished }: { onPublished: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<"idle" | "preparing" | "uploading" | "committing" | "done">("idle");
  const [preparationProgress, setPreparationProgress] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [unsupported, setUnsupported] = useState(false);
  const [useOriginalFile, setUseOriginalFile] = useState(false);
  const [isOriginalFootage, setIsOriginalFootage] = useState(false);
  const [purpose, setPurpose] = useState<"story" | "original">("story");
  const [originalReference, setOriginalReference] = useState("");
  const [rightsHolderName, setRightsHolderName] = useState("");
  const [rightsHolderRole, setRightsHolderRole] = useState<"owner" | "producer">("owner");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null);
  const busy = stage === "preparing" || stage === "uploading" || stage === "committing";

  useEffect(() => () => operation.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    if (file.size > MAX_BYTES) { setError("حجم الملف يتجاوز 2 GB"); return; }
    if (purpose === "original" && originalReference.trim().length < 3) {
      setError("أدخل مرجع تسجيل الأصل أو وثيقة حقوقه");
      return;
    }
    if (purpose === "original" && rightsHolderName.trim().length < 2) {
      setError("أدخل اسم صاحب الحقوق أو المنتج المخوّل");
      return;
    }

    const controller = new AbortController();
    operation.current = controller;
    setError("");
    setReceipt(null);
    setUnsupported(false);
    setPreparationProgress(0);
    setUploadProgress(0);
    try {
      const duration = await mediaDuration(file, controller.signal);
      if (file.type.startsWith("video/") && duration < 60) {
        throw new Error("أي فيديو أقل من 60 ثانية يتم حظره تلقائياً. الحد الأدنى دقيقة واحدة.");
      }
      let uploadFile = file;
      if (file.type.startsWith("video/") && !useOriginalFile) {
        setStage("preparing");
        uploadFile = await prepareVideo(file, controller.signal, setPreparationProgress);
      }
      const metadata: ClipUploadMetadata = {
        title: file.name.slice(0, 120),
        contentType: uploadFile.type,
        durationSec: Math.floor(duration),
        purpose,
        isOriginalFootage,
        ...(purpose === "original" ? {
          originalReference: originalReference.trim(),
          rightsHolderName: rightsHolderName.trim(),
          rightsHolderRole,
        } : {}),
      };
      setStage("uploading");
      const clip = await uploadClip(uploadFile, metadata, controller.signal, percent => {
        setUploadProgress(percent);
        if (percent === 99) setStage("committing");
      });
      setUploadProgress(100);
      setStage("done");
      const rights = clip.rights;
      if (rights?.purpose === "original" && Number.isSafeInteger(rights.registrationId) &&
          typeof rights.registeredAt === "string" && Number.isFinite(Date.parse(rights.registeredAt))) {
        setReceipt({
          id: rights.registrationId,
          registeredAt: rights.registeredAt,
          holder: typeof rights.rightsHolderName === "string" ? rights.rightsHolderName : rightsHolderName.trim(),
          role: rights.rightsHolderRole === "producer" ? "منتج مخوّل" : "صاحب العمل",
        });
      }
      setFile(null);
      if (input.current) input.current.value = "";
      onPublished();
    } catch (caught) {
      if (controller.signal.aborted) {
        setError("تم إلغاء العملية");
      } else {
        if (caught instanceof VideoPreparationUnsupportedError) setUnsupported(true);
        setError(caught instanceof Error ? caught.message : "تعذر نشر الكليب");
      }
      setStage("idle");
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  }

  return (
    <form onSubmit={submit} className="mb-4 space-y-3" dir="rtl" data-testid="clips-upload">
      <Label htmlFor="clip-upload-file">رفع صوت أو فيديو</Label>
      <p className="text-sm text-muted-foreground">يُحضّر الفيديو بدقة لا تتجاوز 480p ومعدل مستهدف 800 kbps قبل الرفع. لا تتغير الملفات الصوتية.</p>
      <Input ref={input} id="clip-upload-file" type="file"
        accept="video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/wav,audio/x-wav,audio/webm,audio/flac,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac"
        disabled={busy}
        onChange={event => {
          const selected = event.target.files?.[0] ?? null;
          setFile(selected);
          setError(selected && selected.size > MAX_BYTES ? "حجم الملف يتجاوز 2 GB" : "");
          setStage("idle");
          setUnsupported(false);
          setUseOriginalFile(false);
          setReceipt(null);
        }} />

      <div className="flex items-center gap-2">
        <Checkbox id="clip-original-footage" checked={isOriginalFootage} disabled={busy}
          onCheckedChange={checked => setIsOriginalFootage(checked === true)} />
        <Label htmlFor="clip-original-footage">أصرّح أن هذا التسجيل مصوّر من هاتفي أو كاميرتي</Label>
      </div>
      <p className="text-sm text-muted-foreground">يمكن نشر التسجيلات المصورة بهاتفك أو كاميرتك بشرط ألا تكون نسخة مطابقة للأصل .</p>

      {(unsupported || useOriginalFile) && file?.type.startsWith("video/") && <div className="flex items-center gap-2">
        <Checkbox id="clip-use-original" checked={useOriginalFile} disabled={busy}
          onCheckedChange={checked => { setUseOriginalFile(checked === true); setError(""); }} />
        <Label htmlFor="clip-use-original">رفع الملف الأصلي دون ضغط بدلاً من ذلك</Label>
      </div>}

      <fieldset disabled={busy} className="space-y-2">
        <legend className="text-sm text-foreground">نوع النشر</legend>
        <RadioGroup value={purpose} disabled={busy} dir="rtl" aria-label="نوع النشر"
          onValueChange={value => { setPurpose(value as "story" | "original"); setError(""); setReceipt(null); }}>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="clip-purpose-story" value="story" />
            <Label htmlFor="clip-purpose-story">ستوري / مقطع مواطن</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="clip-purpose-original" value="original" />
            <Label htmlFor="clip-purpose-original">إيداع أصل لديّ حقوقه</Label>
          </div>
        </RadioGroup>
        {purpose === "original" && <div className="space-y-2">
          <Label htmlFor="clip-rights-holder">اسم صاحب الحقوق أو المنتج المخوّل</Label>
          <Input id="clip-rights-holder" value={rightsHolderName} required minLength={2} maxLength={120}
            disabled={busy} onChange={event => setRightsHolderName(event.target.value)} />
          <RadioGroup value={rightsHolderRole} disabled={busy} dir="rtl" aria-label="صفة صاحب الحقوق"
            onValueChange={value => setRightsHolderRole(value as "owner" | "producer")}>
            <div className="flex items-center gap-2"><RadioGroupItem id="clip-holder-owner" value="owner" /><Label htmlFor="clip-holder-owner">صاحب العمل</Label></div>
            <div className="flex items-center gap-2"><RadioGroupItem id="clip-holder-producer" value="producer" /><Label htmlFor="clip-holder-producer">منتج مخوّل</Label></div>
          </RadioGroup>
          <Label htmlFor="clip-original-reference">مرجع تسجيل الأصل أو وثيقة الحقوق</Label>
          <Input id="clip-original-reference" value={originalReference} required minLength={3} maxLength={200}
            disabled={busy} onChange={event => setOriginalReference(event.target.value)} />
          <p className="text-sm text-muted-foreground">باختيار هذا النوع تصرّح بأنك صاحب الحقوق أو مخوّل بالإيداع نيابةً عنه. يُحفظ الاسم والمرجع وتاريخ الإيداع؛ هذا توثيق داخل المنصة، وليس تحققاً قانونياً من الملكية.</p>
        </div>}
      </fieldset>

      <div className="flex gap-2">
        <Button type="submit" disabled={!file || busy}>{busy ? "جارٍ العمل…" : error && file ? "إعادة المحاولة" : "نشر"}</Button>
        {busy && <Button type="button" variant="outline" onClick={() => operation.current?.abort()}>إلغاء</Button>}
      </div>
      {stage === "preparing" && <div role="status" aria-live="polite">
        <Progress value={preparationProgress} aria-label="تقدم تحضير الفيديو" />
        <p>جارٍ تحضير الفيديو — {preparationProgress}%</p>
      </div>}
      {(stage === "uploading" || stage === "committing" || stage === "done") && <div role="status" aria-live="polite">
        <Progress value={uploadProgress} aria-label="تقدم الرفع" />
        <p>{uploadProgress}%{stage === "committing" ? " — جارٍ تثبيت النشر…" : stage === "done" ? " — تم النشر" : " — جارٍ الرفع"}</p>
      </div>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {receipt && <p className="text-sm text-muted-foreground" data-testid="clip-original-receipt">
        تم إيداع الأصل برقم {receipt.id} باسم {receipt.holder} ({receipt.role}) بتاريخ <time dateTime={receipt.registeredAt}>{new Date(receipt.registeredAt).toLocaleString("ar")}</time> — تصريح بالحقوق، غير محقّق قانونياً.
      </p>}
    </form>
  );
}