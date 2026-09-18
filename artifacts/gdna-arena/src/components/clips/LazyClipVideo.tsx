import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";

type Props = Omit<ComponentPropsWithoutRef<"video">, "src" | "preload"> & { src: string };

/** Attach media only near this video, never by querying other videos on the page. */
export function LazyClipVideo({ src, ...props }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [loadedSource, setLoadedSource] = useState<string>();

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (typeof IntersectionObserver === "undefined") {
      setLoadedSource(src);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.target === video && entry.isIntersecting)) {
        setLoadedSource(src);
        observer.unobserve(video);
      }
    }, { rootMargin: "200px", threshold: 0 });
    observer.observe(video);
    return () => observer.disconnect();
  }, [src]);

  // Scrolling away stops playback; approaching another card never autoplays it.
  useEffect(() => {
    const video = ref.current;
    if (!video || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.target === video && !entry.isIntersecting) && !video.paused) {
        video.pause();
      }
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return <video {...props} ref={ref} controls playsInline preload="none"
    data-src={src} src={loadedSource === src ? src : undefined} />;
}