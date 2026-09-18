import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { SimpleClipUpload } from "@/components/clips/SimpleClipUpload";
import { Button } from "@workspace/gdna-ds/components/ui/button";

type Clip = {
  id: number; video_url: string; content_type?: string; title?: string;
  rights_purpose?: "story" | "original"; rights_registered_at?: string | null;
  rights_holder_name?: string | null; rights_holder_role?: "owner" | "producer" | null;
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
  const { user } = useAuth();
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${BASE}api/clips/feed?limit=5`, { signal, cache: "no-store" });
      const data = response.ok ? await response.json() : null;
      if (!signal?.aborted) {
        setClips(Array.isArray(data?.clips) ? data.clips.filter((clip: Clip | null) =>
          clip && Number.isSafeInteger(clip.id) && typeof clip.video_url === "string" && clip.video_url.length > 0,
        ).slice(0, 5) : []);
      }
    } catch {
      if (!signal?.aborted) setClips([]);
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
      {clips.length === 0 ? <p dir="rtl">لا يوجد كليبز - كن أول من ينشر</p> :
        clips.map(clip => <ClipPlayer key={clip.id} clip={clip} />)}
    </div>
  );
}