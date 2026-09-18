import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { SimpleClipUpload } from "@/components/clips/SimpleClipUpload";
import { Button } from "@workspace/gdna-ds/components/ui/button";

type Clip = {
  id: number; video_url: string; content_type?: string; title?: string;
  rights_purpose?: "story" | "original"; rights_registered_at?: string | null;
  rights_holder_name?: string | null; rights_holder_role?: "owner" | "producer" | null;
  is_original_footage?: boolean;
};
const BASE = import.meta.env.BASE_URL;

function ClipPlayer({ clip }: { clip: Clip }) {
  const [failed, setFailed] = useState(false);
  const audio = typeof clip.content_type === "string" && clip.content_type.startsWith("audio/");
  return <section className="mb-6 space-y-2" dir="rtl">
    <p>{typeof clip.title === "string" ? clip.title : audio ? "مقطع صوتي" : "فيديو"}</p>
    {clip.rights_purpose === "original" && <p className="text-sm text-muted-foreground">
      أصل مودَع — تصريح بالحقوق، غير محقّق قانونياً
      {clip.rights_holder_name && <> · {clip.rights_holder_name} ({clip.rights_holder_role === "producer" ? "منتج مخوّل" : "صاحب العمل"})</>}
      {clip.rights_registered_at && Number.isFinite(Date.parse(clip.rights_registered_at)) &&
        <> · <time dateTime={clip.rights_registered_at}>{new Date(clip.rights_registered_at).toLocaleString("ar")}</time></>}
    </p>}
    {audio ?
      <audio src={clip.video_url} controls preload="metadata" className="w-full" onError={() => setFailed(true)} /> :
      <video src={clip.video_url} controls playsInline preload="metadata" className="w-full" onError={() => setFailed(true)} />}
    {failed && <p role="alert" className="text-muted-foreground">تعذر تشغيل الملف في المتصفح. يمكنك تنزيله وفتحه على جهازك.</p>}
    <Button asChild variant="outline">
      <a href={`${clip.video_url}${clip.video_url.includes("?") ? "&" : "?"}download=1`} download>
        {audio ? "تنزيل الصوت" : "تنزيل الفيديو"}
      </a>
    </Button>
  </section>;
}

export default function ClipsPage() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [feedState, setFeedState] = useState<"loading" | "ready" | "unavailable">("loading");
  const { user } = useAuth();
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setFeedState("loading");
    try {
      const response = await fetch(`${BASE}api/clips/feed?limit=5`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error("Feed request failed");
      const data = await response.json();
      if (!signal?.aborted) {
        const validClip = (clip: unknown): clip is Clip => {
          if (!clip || typeof clip !== "object") return false;
          const candidate = clip as Partial<Clip>;
          return Number.isSafeInteger(candidate.id) && typeof candidate.video_url === "string" && candidate.video_url.length > 0;
        };
        if (!data || !Array.isArray(data.clips) || data.degraded === true || !data.clips.every(validClip)) {
          setClips([]);
          setFeedState("unavailable");
          return;
        }
        setClips(data.clips.slice(0, 5));
        setFeedState("ready");
      }
    } catch {
      if (!signal?.aborted) {
        setClips([]);
        setFeedState("unavailable");
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  return (
    <div className="p-4 pt-20 text-foreground">
      {user ? <SimpleClipUpload key={user.id} onPublished={() => void refresh()} /> :
        <Link href="/login" className="mb-4 block text-primary">سجل الدخول لرفع الصوت أو الفيديو</Link>}
      {feedState === "unavailable" ? <div dir="rtl" role="alert" className="space-y-2">
        <p>الكليبز غير متاحة حالياً. حاول مرة أخرى.</p>
        <Button type="button" variant="outline" onClick={() => void refresh()}>إعادة المحاولة</Button>
      </div> : feedState === "loading" ? <p dir="rtl">جارٍ تحميل الكليبز…</p> :
        clips.length === 0 ? <p dir="rtl">لا يوجد كليبز - كن أول من ينشر</p> :
        clips.map(clip => <ClipPlayer key={clip.id} clip={clip} />)}
    </div>
  );
}