import { useEffect, useState } from "react";
import { Loader2, Pause, Play, ShieldCheck, Upload } from "lucide-react";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@workspace/gdna-ds/components/ui/dialog";
import { Input } from "@workspace/gdna-ds/components/ui/input";
import { Label } from "@workspace/gdna-ds/components/ui/label";
import { Checkbox } from "@workspace/gdna-ds/components/ui/checkbox";
import { Progress } from "@workspace/gdna-ds/components/ui/progress";
import { useLang } from "@/contexts/LangContext";
import { finalLabelText } from "@/i18n/final-labels-copy";
import { clipUploadCopy } from "./clip-upload-copy";
import { useClipUpload } from "./use-clip-upload";

export function ClipUploadDialog({ userId, open, onClose, onDone }: {
  userId: number; open: boolean; onClose: () => void; onDone: () => void;
}) {
  const { lang } = useLang();
  const copy = clipUploadCopy(lang);
  const [title, setTitle] = useState("");
  const [compress, setCompress] = useState(true);
  const [poster, setPoster] = useState<string | null>(null);
  const uploader = useClipUpload(userId, () => { setTitle(""); onDone(); onClose(); });
  const { draft, phase } = uploader;
  const working = ["loading", "preparing", "uploading", "processing", "canceling"].includes(phase);
  const locked = working || Boolean(draft?.urls.some(Boolean));
  const currentTitle = draft?.title ?? title;
  const currentCompress = draft?.compress ?? compress;

  useEffect(() => {
    if (!open || !draft?.thumbnail) { setPoster(null); return; }
    const url = URL.createObjectURL(draft.thumbnail);
    setPoster(url);
    return () => URL.revokeObjectURL(url);
  }, [draft?.thumbnail, open]);

  const close = () => { void uploader.pause(); onClose(); };
  const error = uploader.error === "size" ? copy.size
    : uploader.error === "duration" ? copy.duration
      : uploader.error === "video" ? copy.video : uploader.error;

  return (
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
      <DialogContent dir={lang === "ar" ? "rtl" : "ltr"} className="max-h-[90dvh] overflow-y-auto" aria-busy={working}>
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle className="text-primary">{copy.heading}</DialogTitle>
          <DialogDescription>{copy.guide}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">
          <p className="flex items-start gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-primary" />{finalLabelText(lang, "clipsRightsProtection")}</p>
          <p>{finalLabelText(lang, "clipsRecordingGuide")}</p>
        </div>
        {phase === "loading" && <p role="status">{copy.loading}</p>}
        {uploader.restored && <p role="status" className="text-sm text-primary">{copy.restored}</p>}
        {uploader.storageWarning && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{copy.storage}</p>}
        <div className="space-y-2">
          <Label htmlFor="clip-upload-file">{copy.file}</Label>
          <Input id="clip-upload-file" type="file" accept="video/*" disabled={working || Boolean(draft)}
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) uploader.selectFile(file, title, compress);
              event.target.value = "";
            }} />
          {draft && <><p dir="auto" className="break-all text-sm">{draft.file.name} · {(draft.file.size / 1024 / 1024).toFixed(1)} MiB</p><p className="text-xs text-muted-foreground">{copy.locked}</p></>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="clip-upload-title">{copy.title}</Label>
          <Input id="clip-upload-title" dir="auto" maxLength={120} value={currentTitle} disabled={locked}
            onChange={event => { setTitle(event.target.value); uploader.edit(event.target.value, currentCompress); }} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Checkbox id="clip-upload-compress" checked={currentCompress} disabled={locked || Boolean(draft?.prepared)}
              onCheckedChange={value => { setCompress(value === true); uploader.edit(currentTitle, value === true); }} />
            <Label htmlFor="clip-upload-compress">{copy.compress}</Label>
          </div>
          <p className="text-xs text-muted-foreground">{copy.compressionHelp}</p>
        </div>
        {poster && <figure className="space-y-2"><img src={poster} alt={copy.preview} className="mx-auto max-h-48 rounded-lg object-contain" /><figcaption className="text-xs text-muted-foreground">{copy.preview}</figcaption></figure>}
        {draft?.prepared && <p className="text-xs text-muted-foreground" dir="ltr">{Math.floor(draft.duration / 60)}:{String(Math.floor(draft.duration % 60)).padStart(2, "0")}</p>}
        {phase === "preparing" && <div role="status" className="space-y-2"><p>{copy.preparing} · {Math.floor(uploader.preparation)}%</p><Progress value={uploader.preparation} aria-label={copy.preparing} /></div>}
        {draft?.prepared && <div className="space-y-2">
          <div className="flex justify-between gap-2 text-sm" aria-live="polite"><span>{copy.uploading} · {uploader.progress}%</span><span dir="ltr">{(uploader.speed / 1024 / 1024).toFixed(2)} MiB/s</span></div>
          <Progress value={uploader.progress} aria-label={copy.uploading} />
        </div>}
        {phase === "paused" && <p role="status" className="text-sm text-muted-foreground">{copy.paused}</p>}
        {phase === "processing" && <p role="status" className="flex items-center gap-2 text-sm text-primary"><Loader2 className="h-4 w-4 animate-spin" />{copy.processing}</p>}
        {error && <div role="alert" className="space-y-1 text-sm text-destructive"><p>{copy.failed}</p><p dir="auto">{error}</p></div>}
        <div className="flex flex-wrap gap-2">
          {phase === "uploading" ? <Button variant="outline" onClick={() => void uploader.pause()}><Pause className="h-4 w-4" />{copy.pause}</Button> :
            <Button disabled={working || !draft || !currentTitle.trim()} onClick={() => void uploader.start()}>
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : phase === "paused" ? <Play className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
              {phase === "error" ? copy.retry : phase === "paused" ? copy.resume : finalLabelText(lang, "publishClip")}
            </Button>}
          {draft && <Button variant="destructive" disabled={phase === "processing" || phase === "canceling"} onClick={() => {
            if (window.confirm(copy.confirmCancel)) void uploader.cancel();
          }}>{copy.cancel}</Button>}
          <Button variant="ghost" onClick={close}>{copy.close}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}