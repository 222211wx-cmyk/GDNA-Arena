// CLIPS — كليبسز: lazy-loaded, paginated video grid.
// Owner rules: min duration 1:00 (no upper limit);
// only the owner of the work may publish (sha256 first-owner rights guard).
import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clapperboard, Upload, Eye, Play, Volume2, VolumeX, ShieldCheck, X, Loader2, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Input } from "@workspace/gdna-ds/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@workspace/gdna-ds/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@workspace/gdna-ds/components/ui/alert-dialog";
import { useToast } from "@workspace/gdna-ds/hooks/use-toast";
import { useLang } from "@/contexts/LangContext";
import { finalLabelText } from "@/i18n/final-labels-copy";
import { Skeleton } from "@workspace/gdna-ds/components/ui/skeleton";
import { LazyClipVideo } from "@/components/clips/LazyClipVideo";
import { useClipsFeed, type Clip } from "@/hooks/use-clips-feed";

const BASE = import.meta.env.BASE_URL;
const api = (p: string) => `${BASE}api${p}`;
const MIN_SEC = 60; // owner rule: 1 minute minimum — NO maximum (any chrono above 1 min)
const clipCopy = (lang: string) => {
  const ar = lang === "ar", fr = lang === "fr", es = lang === "es";
  return {
    soundOn: ar ? "تشغيل الصوت" : fr ? "Activer le son" : es ? "Activar sonido" : "Turn sound on",
    soundOff: ar ? "كتم الصوت" : fr ? "Couper le son" : es ? "Silenciar sonido" : "Mute sound",
    editLabel: ar ? "تعديل عنوان الكليب" : fr ? "Modifier le titre du clip" : es ? "Editar título del clip" : "Edit clip title",
    deleteLabel: ar ? "حذف الكليب" : fr ? "Supprimer le clip" : es ? "Eliminar clip" : "Delete clip",
    editTitle: ar ? "تعديل عنوان الكليب" : fr ? "Modifier le titre du clip" : es ? "Editar título del clip" : "Edit clip title",
    editDescription: ar ? "اختار عنوان واضح لعملك، حتى 120 حرفاً." : fr ? "Choisissez un titre clair pour votre œuvre, jusqu'à 120 caractères." : es ? "Elige un título claro para tu obra, hasta 120 caracteres." : "Choose a clear title for your work, up to 120 characters.",
    titleLabel: ar ? "عنوان الكليب" : fr ? "Titre du clip" : es ? "Título del clip" : "Clip title",
    cancel: ar ? "إلغاء" : fr ? "Annuler" : es ? "Cancelar" : "Cancel", save: ar ? "حفظ العنوان" : fr ? "Enregistrer le titre" : es ? "Guardar título" : "Save title",
    deleteConfirm: ar ? "حذف الكليب نهائياً؟" : fr ? "Supprimer définitivement le clip ?" : es ? "¿Eliminar el clip permanentemente?" : "Delete clip permanently?",
    deleteDescription: ar ? "سيتم حذف الفيديو والمشاهدات من الإمبراطورية. لا يمكن استرجاعه بعد ذلك." : fr ? "La vidéo et ses vues seront supprimées de l'Empire. Cette action est irréversible." : es ? "El video y sus vistas se eliminarán del Imperio. No se puede deshacer." : "The video and its views will be deleted from the Empire. This cannot be undone.",
    deleteForever: ar ? "حذف نهائياً" : fr ? "Supprimer définitivement" : es ? "Eliminar permanentemente" : "Delete permanently",
    minError: ar ? "المدة الدنيا: دقيقة واحدة. الكليبات الأقل من دقيقة غير مسموحة." : fr ? "Durée minimale : 1 minute. Les clips de moins d'une minute sont interdits." : es ? "Duración mínima: 1 minuto. No se permiten clips de menos de un minuto." : "Minimum duration: 1 minute. Clips shorter than one minute are not allowed.",
    videoError: ar ? "تعذر قراءة الفيديو" : fr ? "Impossible de lire la vidéo" : es ? "No se pudo leer el vídeo" : "We could not read the video",
    publishError: ar ? "فشل النشر" : fr ? "Échec de la publication" : es ? "Error al publicar" : "Publishing failed",
    networkError: ar ? "فشل الاتصال — حاول مجدداً" : fr ? "Échec de connexion — réessayez" : es ? "Error de conexión — inténtalo de nuevo" : "Connection failed — try again",
    titleUpdateError: ar ? "تعذر تعديل العنوان" : fr ? "Impossible de modifier le titre" : es ? "No se pudo editar el título" : "Could not edit the title",
    titleUpdated: ar ? "تم تعديل عنوان الكليب" : fr ? "Titre du clip modifié" : es ? "Título del clip actualizado" : "Clip title updated",
    retry: ar ? "حاول مجدداً" : fr ? "Réessayez" : es ? "Inténtalo de nuevo" : "Try again",
    uploadTitle: ar ? "نشر كليب" : fr ? "Publier un clip" : es ? "Publicar un clip" : "Publish a clip",
    clipPlaceholder: ar ? "عنوان الكليب..." : fr ? "Titre du clip..." : es ? "Título del clip..." : "Clip title...",
    durationGuide: ar ? "المدة: دقيقة واحدة على الأقل · بلا حد أقصى." : fr ? "Durée : 1 minute minimum · Aucune limite maximale." : es ? "Duración: mínimo 1 minuto · Sin límite máximo." : "Duration: 1 minute minimum · No maximum limit.",
    duration: ar ? "المدة" : fr ? "Durée" : es ? "Duración" : "Duration",
    rightsGuide: ar ? "المدة: دقيقة واحدة على الأقل · بلا حد أقصى · حقوق المؤلف محفوظة لصاحب العمل" : fr ? "Durée : 1 minute minimum · Aucune limite maximale · Droits d’auteur réservés au propriétaire de l’œuvre" : es ? "Duración: mínimo 1 minuto · Sin límite máximo · Derechos de autor reservados al propietario de la obra" : "Duration: 1 minute minimum · No maximum limit · Copyright reserved by the owner of the work",
    loadMore: ar ? "تحميل المزيد" : fr ? "Charger plus" : es ? "Cargar más" : lang === "de" ? "Mehr laden" : "Load more",
  };
};

function fmtDur(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

// ── One clip card (loads near the viewport; plays on demand) ─────────────────
function ClipCard({
  clip, canManage, onUpdated, onDeleted,
}: {
  clip: Clip;
  canManage: boolean;
  onUpdated: (id: number, title: string) => void;
  onDeleted: (id: number) => void;
}) {
  const { lang } = useLang();
  const copy = clipCopy(lang);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [views, setViews] = useState(clip.views);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState(clip.title);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const counted = useRef(false);
  const { toast } = useToast();

  const recordPlayback = () => {
    setPlaying(true);
    if (counted.current) return;
    counted.current = true;
    fetch(api(`/clips/${clip.id}/view`), { method: "POST", credentials: "include" })
      .then(response => {
        if (!response.ok) throw new Error("View could not be recorded");
        return response.json();
      })
      .then(data => { if (typeof data.views === "number") setViews(data.views); })
      .catch(() => { counted.current = false; });
  };

  const saveTitle = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = draftTitle.trim();
    if (!title || saving) return;
    setSaving(true);
    try {
      const response = await fetch(api(`/clips/${clip.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? copy.titleUpdateError);
      onUpdated(clip.id, data.clip.title);
      setEditOpen(false);
      toast({ title: copy.titleUpdated });
    } catch (error) {
      toast({
        title: copy.titleUpdateError,
        description: error instanceof Error ? error.message : copy.retry,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteClip = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const response = await fetch(api(`/clips/${clip.id}`), {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? finalLabelText(lang, "clipsDeleteError"));
      }
      setDeleteOpen(false);
      onDeleted(clip.id);
      toast({ title: finalLabelText(lang, "clipsDeleted") });
    } catch (error) {
      toast({
        title: finalLabelText(lang, "clipsDeleteError"),
        description: error instanceof Error ? error.message : finalLabelText(lang, "tryAgain"),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="relative aspect-[9/16] rounded-xl overflow-hidden border border-border bg-card min-w-0">
      <LazyClipVideo src={api(`/clips/stream/${clip.id}`)} poster={clip.thumb} loop muted={muted}
        aria-label={clip.title} className="w-full h-full object-cover bg-background"
        onPlaying={recordPlayback} onPause={() => setPlaying(false)}
        onVolumeChange={event => setMuted(event.currentTarget.muted)} />
      {/* Overlay info */}
      <div className="absolute bottom-12 inset-x-0 p-4 pointer-events-none bg-gradient-to-t from-background/90 to-transparent">
        <p className="font-black text-foreground text-sm md:text-lg leading-tight break-words" dir="auto">{clip.title}</p>
        <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs font-mono text-primary">
          <span>👑 {clip.username}</span>
          <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {views}</span>
          <span>⏱️ {fmtDur(clip.duration_sec)}</span>
        </div>
      </div>
      <div className="absolute top-3 right-3 flex gap-2">
        <Button type="button" variant="outline" size="icon" onClick={() => setMuted(m => !m)}
          className="rounded-full bg-background/80 text-foreground" aria-label={muted ? copy.soundOn : copy.soundOff}>
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </Button>
      </div>
      {canManage && (
        <div className="absolute top-3 left-3 flex gap-2">
          <Button type="button" variant="outline" size="icon" className="bg-background/80 text-foreground"
            aria-label={copy.editLabel}
            onClick={() => { setDraftTitle(clip.title); setEditOpen(true); }}>
            <Pencil />
          </Button>
          <Button type="button" variant="destructive" size="icon" className="bg-destructive/90"
            aria-label={copy.deleteLabel} onClick={() => setDeleteOpen(true)}>
            <Trash2 />
          </Button>
        </div>
      )}
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full flex items-center justify-center bg-background/50 border border-primary">
            <Play className="w-7 h-7 ml-1 text-primary" />
          </div>
        </div>
      )}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent dir={lang === "ar" ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{copy.editTitle}</DialogTitle>
            <DialogDescription>{copy.editDescription}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={saveTitle}>
            <Input value={draftTitle} maxLength={120} dir="auto" autoFocus disabled={saving}
              onChange={event => setDraftTitle(event.target.value)} aria-label={copy.titleLabel} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>{copy.cancel}</Button>
              <Button type="submit" disabled={saving || !draftTitle.trim()}>
                {saving ? <Loader2 className="animate-spin" /> : <Pencil />} {copy.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent dir={lang === "ar" ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.deleteConfirm}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.deleteDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{copy.cancel}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground"
              disabled={deleting} onClick={event => { event.preventDefault(); void deleteClip(); }}>
              {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />} {copy.deleteForever}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Upload modal ─────────────────────────────────────────────────────────────
function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { lang } = useLang();
  const copy = clipCopy(lang);
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const pick = (f: File | null) => {
    setFile(f); setDuration(null); setError(null);
    if (!f) return;
    const url = URL.createObjectURL(f);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      setDuration(v.duration);
      if (v.duration < MIN_SEC) setError(copy.minError);
    };
    v.onerror = () => { URL.revokeObjectURL(url); setError(copy.videoError); };
    v.src = url;
  };

  const publish = () => {
    if (!file || !duration || duration < MIN_SEC || !title.trim() || busy) return;
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.append("title", title.trim());
    fd.append("durationSec", String(Math.floor(duration)));
    fd.append("video", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", api("/clips"));
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setBusy(false);
      if (xhr.status === 200) { onDone(); onClose(); }
      else { try { setError(JSON.parse(xhr.responseText).error ?? copy.publishError); } catch { setError(copy.publishError); } }
    };
    xhr.onerror = () => { setBusy(false); setError(copy.networkError); };
    xhr.send(fd);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      dir={lang === "ar" ? "rtl" : "ltr"}
      className="fixed inset-0 z-[1100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={() => !busy && onClose()}>
      <div className="w-full max-w-md rounded-2xl border p-5 space-y-4"
        style={{ background: "#0a0a0a", borderColor: "#C9A84C50" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
           <h3 className="font-black text-lg" style={{ color: "#C9A84C" }}>🎬 {copy.uploadTitle}</h3>
          <button onClick={() => !busy && onClose()} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="text-[11px] leading-relaxed rounded-lg border p-3 space-y-1" style={{ borderColor: "#C9A84C30", color: "#d4c391" }}>
          <p>⏱️ {copy.durationGuide}</p>
          <p className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 shrink-0" /> {finalLabelText(lang, "clipsRightsProtection")}</p>
          <p>📱 {finalLabelText(lang, "clipsRecordingGuide")}</p>
        </div>
        <input type="file" accept="video/mp4,video/webm,video/quicktime"
          onChange={e => pick(e.target.files?.[0] ?? null)} disabled={busy}
          className="w-full text-xs text-gray-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-yellow-400/10 file:text-yellow-400" />
        <p className="text-sm text-yellow-400">⚠️ {copy.durationGuide}</p>
        {file && duration !== null && (
          <p className="text-xs font-mono" style={{ color: duration >= MIN_SEC ? "#22c55e" : "#ef4444" }}>
            {copy.duration}: {fmtDur(Math.floor(duration))} {duration >= MIN_SEC ? "✅" : "❌"}
          </p>
        )}
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} dir="auto" disabled={busy}
           placeholder={copy.clipPlaceholder} className="w-full px-3 py-2.5 rounded-lg bg-black border text-white text-sm outline-none"
          style={{ borderColor: "#C9A84C40" }} />
        {error && <p className="text-xs text-red-400" dir="auto">{error}</p>}
        {busy && (
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "#1a1a1a" }}>
            <div className="h-full transition-all" style={{ width: `${progress}%`, background: "linear-gradient(90deg,#C9A84C,#FFD700)" }} />
          </div>
        )}
        <button onClick={publish}
          disabled={busy || !file || !title.trim() || duration === null || duration < MIN_SEC}
          className="w-full py-3 rounded-xl font-black text-black disabled:opacity-40 flex items-center justify-center gap-2"
          style={{ background: "linear-gradient(135deg,#C9A84C,#FFD700)" }}>
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> {finalLabelText(lang, "uploading")} {progress}%</> : <><Upload className="w-4 h-4" /> {finalLabelText(lang, "publishClip")}</>}
        </button>
      </div>
    </motion.div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ClipsPage() {
  const { lang } = useLang();
  const copy = clipCopy(lang);
  const { user } = useAuth();
  const { clips, setClips, loading, loadingMore, hasMore, error, refresh, loadMore } = useClipsFeed();
  const [showUpload, setShowUpload] = useState(false);

  const updateClipTitle = useCallback((id: number, title: string) => {
    setClips(previous => previous.map(clip => clip.id === id ? { ...clip, title } : clip));
  }, []);

  const removeClip = useCallback((id: number) => {
    setClips(previous => previous.filter(clip => clip.id !== id));
  }, []);

  return (
    <div className="min-h-screen pt-20 pb-12 bg-background" dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="max-w-6xl mx-auto px-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="font-black text-2xl flex items-center gap-2 text-foreground">
            <Clapperboard className="w-6 h-6 text-primary" /> {finalLabelText(lang, "clipsHeading")}
          </h1>
          {user && (
            <Button onClick={() => setShowUpload(true)}>
              <Upload className="w-4 h-4" /> {finalLabelText(lang, "publish")}
            </Button>
          )}
        </div>
        <p className="text-xs font-mono text-muted-foreground">
          {copy.rightsGuide}
        </p>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4" aria-busy="true">
            {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="aspect-[9/16] rounded-xl" />)}
          </div>
        ) : clips.length === 0 && !error ? (
          <div className="h-[50vh] rounded-xl border border-border flex flex-col items-center justify-center gap-3 text-center px-6">
            <Clapperboard className="w-10 h-10 text-primary" />
            <p className="text-foreground font-bold">{finalLabelText(lang, "noClips")}</p>
            <p className="text-xs text-muted-foreground">{finalLabelText(lang, "noClipsDescription")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4" data-testid="clips-grid">
            {clips.map(c => (
              <ClipCard key={c.id} clip={c} canManage={c.user_id === user?.id}
                onUpdated={updateClipTitle} onDeleted={removeClip} />
            ))}
          </div>
        )}
        {error && (
          <div role="alert" className="text-center space-y-3">
            <p className="text-destructive">{copy.networkError}</p>
            {!hasMore && <Button variant="outline" onClick={() => void refresh()}>{copy.retry}</Button>}
          </div>
        )}
        {!loading && hasMore && (
          <Button variant="outline" className="mx-auto flex rounded-full" disabled={loadingMore}
            onClick={() => void loadMore()} data-testid="clips-load-more">
            {loadingMore && <Loader2 className="animate-spin" />}
            {error ? copy.retry : copy.loadMore}
          </Button>
        )}
      </div>
      <AnimatePresence>
        {showUpload && <UploadModal onClose={() => setShowUpload(false)} onDone={() => { void refresh(); }} />}
      </AnimatePresence>
    </div>
  );
}
