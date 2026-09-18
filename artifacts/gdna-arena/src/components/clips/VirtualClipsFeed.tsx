// VIRTUALIZED CLIPS FEED — TikTok-style vertical feed with TRUE DOM virtualization.
// Only the current card and its immediate neighbours (current +/- 1) are rendered
// to the DOM at all; the rest of the scroll height is held by top/bottom spacers.
// Row height is measured with a ResizeObserver, and the active index is derived
// from the scroll position on a passive + rAF listener so jumping far still lands
// on the correct window. Only one video ever plays (LazyClipVideo enforces it,
// including manual native play). Sources/preloading are granted to the active and
// next-1 cards only; every other slot is a poster-only placeholder.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Eye,
  Play,
  Volume2,
  VolumeX,
  Crown,
  Timer,
  Loader2,
  Pencil,
  Trash2,
  Download,
} from "lucide-react";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Input } from "@workspace/gdna-ds/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/gdna-ds/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/gdna-ds/components/ui/alert-dialog";
import { useToast } from "@workspace/gdna-ds/hooks/use-toast";
import { useLang } from "@/contexts/LangContext";
import { finalLabelText } from "@/i18n/final-labels-copy";
import { LazyClipVideo } from "@/components/clips/LazyClipVideo";
import type { Clip } from "@/components/clips/clip-feed-data";

const BASE = import.meta.env.BASE_URL;
const api = (p: string) => `${BASE}api${p}`;
// Auto-fetch when the active card is this close to the tail of the list.
const PREFETCH_MARGIN = 2;
// Fallback row height (px) before the first measurement lands.
const DEFAULT_ROW_HEIGHT = 640;
// A feed shorter than this is unusable, so we never shrink a row below it. This
// guards against a measured top offset that (transiently) eats the whole viewport.
const MIN_ROW_HEIGHT = 160;

const feedCopy = (lang: string) => {
  const ar = lang === "ar",
    fr = lang === "fr",
    es = lang === "es";
  return {
    soundOn: ar ? "تشغيل الصوت" : fr ? "Activer le son" : es ? "Activar sonido" : "Turn sound on",
    soundOff: ar ? "كتم الصوت" : fr ? "Couper le son" : es ? "Silenciar sonido" : "Mute sound",
    download: ar ? "تنزيل الفيديو" : fr ? "Télécharger la vidéo" : es ? "Descargar el video" : lang === "de" ? "Video herunterladen" : "Download video",
    editLabel: ar ? "تعديل عنوان الكليب" : fr ? "Modifier le titre du clip" : es ? "Editar título del clip" : "Edit clip title",
    deleteLabel: ar ? "حذف الكليب" : fr ? "Supprimer le clip" : es ? "Eliminar clip" : "Delete clip",
    editTitle: ar ? "تعديل عنوان الكليب" : fr ? "Modifier le titre du clip" : es ? "Editar título del clip" : "Edit clip title",
    editDescription: ar ? "اختار عنوان واضح لعملك، حتى 120 حرفاً." : fr ? "Choisissez un titre clair pour votre œuvre, jusqu'à 120 caractères." : es ? "Elige un título claro para tu obra, hasta 120 caracteres." : "Choose a clear title for your work, up to 120 characters.",
    titleLabel: ar ? "عنوان الكليب" : fr ? "Titre du clip" : es ? "Título del clip" : "Clip title",
    cancel: ar ? "إلغاء" : fr ? "Annuler" : es ? "Cancelar" : "Cancel",
    save: ar ? "حفظ العنوان" : fr ? "Enregistrer le titre" : es ? "Guardar título" : "Save title",
    deleteConfirm: ar ? "حذف الكليب نهائياً؟" : fr ? "Supprimer définitivement le clip ?" : es ? "¿Eliminar el clip permanentemente?" : "Delete clip permanently?",
    deleteDescription: ar ? "سيتم حذف الفيديو والمشاهدات من الإمبراطورية. لا يمكن استرجاعه بعد ذلك." : fr ? "La vidéo et ses vues seront supprimées de l'Empire. Cette action est irréversible." : es ? "El video y sus vistas se eliminarán del Imperio. No se puede deshacer." : "The video and its views will be deleted from the Empire. This cannot be undone.",
    deleteForever: ar ? "حذف نهائياً" : fr ? "Supprimer définitivement" : es ? "Eliminar permanentemente" : "Delete permanently",
    titleUpdateError: ar ? "تعذر تعديل العنوان" : fr ? "Impossible de modifier le titre" : es ? "No se pudo editar el título" : "Could not edit the title",
    titleUpdated: ar ? "تم تعديل عنوان الكليب" : fr ? "Titre du clip modifié" : es ? "Título del clip actualizado" : "Clip title updated",
    retry: ar ? "حاول مجدداً" : fr ? "Réessayez" : es ? "Inténtalo de nuevo" : "Try again",
    loadMore: ar ? "تحميل المزيد" : fr ? "Charger plus" : es ? "Cargar más" : "Load more",
    loadError: ar ? "فشل تحميل المزيد — حاول مجدداً" : fr ? "Échec du chargement — réessayez" : es ? "Error al cargar más — inténtalo de nuevo" : "Could not load more — try again",
    end: ar ? "وصلت إلى نهاية الكليبات" : fr ? "Vous avez atteint la fin des clips" : es ? "Has llegado al final de los clips" : "You have reached the end of the clips",
  };
};

function fmtDur(s: number) {
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

// ── One clip card ────────────────────────────────────────────────────────────
function ClipCard({
  clip,
  active,
  preload,
  muted,
  onToggleMute,
  canManage,
  onUpdated,
  onDeleted,
}: {
  clip: Clip;
  active: boolean;
  preload: "none" | "metadata";
  muted: boolean;
  onToggleMute: () => void;
  canManage: boolean;
  onUpdated: (id: number, title: string) => void;
  onDeleted: (id: number) => void;
}) {
  const { lang } = useLang();
  const copy = feedCopy(lang);
  const { toast } = useToast();
  const [playing, setPlaying] = useState(false);
  const [views, setViews] = useState(clip.views);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState(clip.title);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const counted = useRef(false);

  // A view is counted only when playback actually begins, once per card.
  const recordPlayback = useCallback(() => {
    setPlaying(true);
    if (counted.current) return;
    counted.current = true;
    fetch(api(`/clips/${clip.id}/view`), { method: "POST", credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error("View could not be recorded");
        return response.json();
      })
      .then((data) => {
        if (typeof data.views === "number") setViews(data.views);
      })
      .catch(() => {
        counted.current = false;
      });
  }, [clip.id]);

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
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-card">
      <LazyClipVideo
        src={api(`/clips/stream/${clip.id}`)}
        poster={clip.thumb ?? undefined}
        loop
        muted={muted}
        active={active}
        preload={preload}
        aria-label={clip.title}
        className="h-full w-full bg-background object-contain"
        onPlaybackStarted={recordPlayback}
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />

      {/* Overlay info */}
      <div className="pointer-events-none absolute inset-x-0 bottom-12 bg-gradient-to-t from-background/90 to-transparent p-4">
        <p className="break-words text-sm font-black leading-tight text-foreground md:text-lg" dir="auto">
          {clip.title}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-3 font-mono text-xs text-primary">
          <span className="flex items-center gap-1">
            <Crown className="h-3 w-3" /> {clip.username}
          </span>
          <span className="flex items-center gap-1">
            <Eye className="h-3 w-3" /> {views}
          </span>
          <span className="flex items-center gap-1">
            <Timer className="h-3 w-3" /> {fmtDur(clip.duration_sec)}
          </span>
        </div>
      </div>

      <div className="absolute end-3 top-3 flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onToggleMute}
          className="rounded-full bg-background/80 text-foreground"
          aria-label={muted ? copy.soundOn : copy.soundOff}
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </Button>
        {/* Native anchor download: streams from the server (Content-Disposition
            handled server-side) instead of buffering the whole video in JS. */}
        <Button
          asChild
          variant="outline"
          size="icon"
          className="rounded-full bg-background/80 text-foreground"
        >
          <a
            href={api(`/clips/stream/${clip.id}?download=1`)}
            download
            aria-label={copy.download}
            data-testid="clip-download"
          >
            <Download className="h-4 w-4" />
          </a>
        </Button>
      </div>

      {canManage && (
        <div className="absolute start-3 top-3 flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="bg-background/80 text-foreground"
            aria-label={copy.editLabel}
            onClick={() => {
              setDraftTitle(clip.title);
              setEditOpen(true);
            }}
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="bg-destructive/90"
            aria-label={copy.deleteLabel}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 />
          </Button>
        </div>
      )}

      {!playing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-primary bg-background/50">
            <Play className="ms-1 h-7 w-7 text-primary" />
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
            <Input
              value={draftTitle}
              maxLength={120}
              dir="auto"
              autoFocus
              disabled={saving}
              onChange={(event) => setDraftTitle(event.target.value)}
              aria-label={copy.titleLabel}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
                {copy.cancel}
              </Button>
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
            <AlertDialogDescription>{copy.deleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{copy.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void deleteClip();
              }}
            >
              {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />} {copy.deleteForever}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── The virtualized feed ─────────────────────────────────────────────────────
export function VirtualClipsFeed({
  clips,
  currentUserId,
  hasMore,
  loadingMore,
  error,
  onLoadMore,
  onUpdated,
  onDeleted,
}: {
  clips: Clip[];
  currentUserId?: number;
  hasMore: boolean;
  loadingMore: boolean;
  error: boolean;
  onLoadMore: () => void | Promise<void>;
  onUpdated: (id: number, title: string) => void;
  onDeleted: (id: number) => void;
}) {
  const { lang } = useLang();
  const copy = feedCopy(lang);
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Each row fills exactly the feed's visible height, so the active card is fully
  // (>=80%) visible without the user scrolling — otherwise autoplay never fires.
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const [muted, setMuted] = useState(true);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;
  const rowHeightRef = useRef(rowHeight);
  rowHeightRef.current = rowHeight;
  const rafRef = useRef<number | null>(null);

  // Clamp the active index whenever the list shrinks (e.g. a delete at the tail).
  useEffect(() => {
    setActiveIndex((index) => {
      if (clips.length === 0) return 0;
      return Math.min(index, clips.length - 1);
    });
  }, [clips.length]);

  // Size each row to the feed's REMAINING visible height, measured from the
  // container's real top offset (below nav + title + rights + any dev banner) to
  // the bottom of the viewport. Measuring the viewport — not the card — keeps the
  // active card fully visible so autoplay fires, and avoids the row-height <->
  // card-height ResizeObserver feedback loop that a card-driven measure would cause.
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const apply = () => {
      const top = node.getBoundingClientRect().top;
      const visible = window.innerHeight - top;
      const next = Math.max(MIN_ROW_HEIGHT, Math.round(visible));
      setRowHeight((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    };
    apply();
    // Re-measure on viewport resize and orientation change.
    window.addEventListener("resize", apply);
    // The container's top can shift as content above it (banners, etc.) settles;
    // observe the document body so those layout changes re-run the measure. This
    // never observes the feed's own children, so it cannot feed back on itself.
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(apply);
      observer.observe(document.body);
    }
    // A late scroll of the page (not the feed) also changes the container top.
    window.addEventListener("scroll", apply, { passive: true });
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("scroll", apply);
      observer?.disconnect();
    };
  }, []);

  // Derive the active index from scroll position on a passive listener throttled
  // through rAF, so a large jump lands on the correct window immediately.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const compute = () => {
      rafRef.current = null;
      const h = rowHeightRef.current || DEFAULT_ROW_HEIGHT;
      const next = Math.round(root.scrollTop / h);
      setActiveIndex((index) => {
        const clamped = Math.max(0, Math.min(next, Math.max(0, clips.length - 1)));
        return clamped === index ? index : clamped;
      });
    };
    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(compute);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [clips.length]);

  // Auto-fetch when the active card nears the tail; retry surfaces on error.
  useEffect(() => {
    if (!hasMore || loadingMore || error) return;
    if (clips.length > 0 && activeIndex >= clips.length - 1 - PREFETCH_MARGIN) {
      void onLoadMoreRef.current();
    }
  }, [activeIndex, clips.length, hasMore, loadingMore, error]);

  // TRUE DOM virtualization: render only current +/- 1; hold the rest with spacers.
  const start = Math.max(0, activeIndex - 1);
  const end = Math.min(clips.length - 1, activeIndex + 1);
  const topSpacer = start * rowHeight;
  const bottomSpacer = Math.max(0, clips.length - 1 - end) * rowHeight;
  const windowClips = clips.slice(start, end + 1);

  return (
    <div
      ref={containerRef}
      data-testid="clips-virtual-feed"
      style={{ height: rowHeight }}
      className="snap-y snap-mandatory overflow-y-auto rounded-xl"
    >
      {topSpacer > 0 && <div data-testid="clips-spacer-top" style={{ height: topSpacer }} aria-hidden="true" />}

      {windowClips.map((clip, offset) => {
        const index = start + offset;
        const active = index === activeIndex;
        // Metadata (and therefore the media source) is granted to the active and
        // the next-1 card only; every other slot never downloads any video.
        const preload: "none" | "metadata" =
          index === activeIndex || index === activeIndex + 1 ? "metadata" : "none";
        return (
          <div
            key={clip.id}
            data-index={index}
            data-testid={`clip-slot-${index}`}
            data-active={active ? "true" : "false"}
            style={{ height: rowHeight }}
            className="flex snap-start items-center justify-center py-2"
          >
            {/* Constrain to 9:16 without ever exceeding the viewport width. */}
            <div className="aspect-[9/16] h-full max-h-full w-auto max-w-full">
              <ClipCard
                clip={clip}
                active={active}
                preload={preload}
                muted={muted}
                onToggleMute={() => setMuted((value) => !value)}
                canManage={clip.user_id === currentUserId}
                onUpdated={onUpdated}
                onDeleted={onDeleted}
              />
            </div>
          </div>
        );
      })}

      {bottomSpacer > 0 && (
        <div data-testid="clips-spacer-bottom" style={{ height: bottomSpacer }} aria-hidden="true" />
      )}

      <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
        {loadingMore && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        )}
        {error && (
          <div role="alert" className="space-y-2">
            <p className="text-sm text-destructive">{copy.loadError}</p>
            <Button
              variant="outline"
              className="rounded-full"
              disabled={loadingMore}
              onClick={() => void onLoadMore()}
              data-testid="clips-load-more"
            >
              {loadingMore && <Loader2 className="animate-spin" />} {copy.retry}
            </Button>
          </div>
        )}
        {!error && hasMore && (
          <Button
            variant="outline"
            className="rounded-full"
            disabled={loadingMore}
            onClick={() => void onLoadMore()}
            data-testid="clips-load-more"
          >
            {loadingMore && <Loader2 className="animate-spin" />}
            {copy.loadMore}
          </Button>
        )}
        {!error && !hasMore && clips.length > 0 && (
          <p className="text-xs text-muted-foreground">{copy.end}</p>
        )}
      </div>
    </div>
  );
}
