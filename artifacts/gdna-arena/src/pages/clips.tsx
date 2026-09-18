// CLIPS — كليبسز: lazy-loaded, TikTok-style virtualized video feed.
// Owner rules: min duration 1:00 (no upper limit);
// only the owner of the work may publish (sha256 first-owner rights guard).
import { lazy, Suspense, useState, useCallback } from "react";
import { Clapperboard, Upload } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { useLang } from "@/contexts/LangContext";
import { finalLabelText } from "@/i18n/final-labels-copy";
import { Skeleton } from "@workspace/gdna-ds/components/ui/skeleton";
import { VirtualClipsFeed } from "@/components/clips/VirtualClipsFeed";
import { useClipsFeed } from "@/hooks/use-clips-feed";

const ClipUploadDialog = lazy(() => import("@/components/clips/ClipUploadDialog").then(module => ({ default: module.ClipUploadDialog })));

const clipCopy = (lang: string) => {
  const ar = lang === "ar", fr = lang === "fr", es = lang === "es", de = lang === "de";
  return {
    networkError: ar ? "فشل الاتصال — حاول مجدداً" : fr ? "Échec de connexion — réessayez" : es ? "Error de conexión — inténtalo de nuevo" : de ? "Verbindung fehlgeschlagen — erneut versuchen" : "Connection failed — try again",
    retry: ar ? "حاول مجدداً" : fr ? "Réessayez" : es ? "Inténtalo de nuevo" : de ? "Erneut versuchen" : "Try again",
    rightsGuide: ar ? "المدة: دقيقة واحدة على الأقل · بلا حد أقصى · حقوق المؤلف محفوظة لصاحب العمل" : fr ? "Durée : 1 minute minimum · Aucune limite maximale · Droits d’auteur réservés au propriétaire de l’œuvre" : es ? "Duración: mínimo 1 minuto · Sin límite máximo · Derechos de autor reservados al propietario de la obra" : de ? "Dauer: mindestens 1 Minute · Keine Höchstdauer · Urheberrecht beim Eigentümer des Werks" : "Duration: 1 minute minimum · No maximum limit · Copyright reserved by the owner of the work",
  };
};

export default function ClipsPage() {
  const { lang } = useLang();
  const copy = clipCopy(lang);
  const { user } = useAuth();
  const { clips, setClips, loading, loadingMore, hasMore, error, refresh, loadMore } = useClipsFeed();
  const [showUpload, setShowUpload] = useState(false);
  const [uploadRequested, setUploadRequested] = useState(false);

  const updateClipTitle = useCallback((id: number, title: string) => {
    setClips(previous => previous.map(clip => clip.id === id ? { ...clip, title } : clip));
  }, []);

  const removeClip = useCallback((id: number) => {
    setClips(previous => previous.filter(clip => clip.id !== id));
  }, []);

  return (
    <div className="min-h-[100dvh] bg-background pb-6 pt-20" dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="max-w-6xl mx-auto px-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="font-black text-2xl flex items-center gap-2 text-foreground">
            <Clapperboard className="w-6 h-6 text-primary" /> {finalLabelText(lang, "clipsHeading")}
          </h1>
          {user && (
            <Button onClick={() => { setUploadRequested(true); setShowUpload(true); }}>
              <Upload className="w-4 h-4" /> {finalLabelText(lang, "publish")}
            </Button>
          )}
        </div>
        <p className="text-xs font-mono text-muted-foreground">
          {copy.rightsGuide}
        </p>

        {loading ? (
          <div className="flex justify-center" aria-busy="true">
            <Skeleton className="aspect-[9/16] h-[calc(100dvh-11rem)] rounded-xl" />
          </div>
        ) : clips.length === 0 && error ? (
          <div role="alert" className="flex h-[50vh] flex-col items-center justify-center gap-3 rounded-xl border border-border px-6 text-center">
            <p className="text-destructive">{copy.networkError}</p>
            <Button variant="outline" className="rounded-full" onClick={() => void refresh()} data-testid="clips-retry">
              {copy.retry}
            </Button>
          </div>
        ) : clips.length === 0 ? (
          <div className="flex h-[50vh] flex-col items-center justify-center gap-3 rounded-xl border border-border px-6 text-center">
            <Clapperboard className="h-10 w-10 text-primary" />
            <p className="font-bold text-foreground">{finalLabelText(lang, "noClips")}</p>
            <p className="text-xs text-muted-foreground">{finalLabelText(lang, "noClipsDescription")}</p>
          </div>
        ) : (
          <VirtualClipsFeed
            clips={clips}
            currentUserId={user?.id}
            hasMore={hasMore}
            loadingMore={loadingMore}
            error={error}
            onLoadMore={loadMore}
            onUpdated={updateClipTitle}
            onDeleted={removeClip}
          />
        )}
      </div>
      {user && uploadRequested && <Suspense fallback={<Skeleton className="mx-auto h-12 w-40" aria-busy="true" aria-label={finalLabelText(lang, "publishClip")} />}>
        <ClipUploadDialog key={user.id} userId={user.id} open={showUpload}
          onClose={() => setShowUpload(false)} onDone={() => { void refresh(); }} />
      </Suspense>}
    </div>
  );
}