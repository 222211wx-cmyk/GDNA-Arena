import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";

type Props = Omit<
  ComponentPropsWithoutRef<"video">,
  "src" | "preload" | "autoPlay"
> & {
  src: string;
  /** Parent designates the single current card; only an active + visible video plays. */
  active?: boolean;
  /**
   * Parent grants "metadata" only to the active and next-1 videos; everyone else
   * stays "none". A metadata grant is also what attaches the media source, so a
   * non-granted card never downloads any video resource (poster stays separate).
   */
  preload?: "none" | "metadata";
  /** Fires once real playback actually begins (used for a truthful view count). */
  onPlaybackStarted?: () => void;
};

/**
 * The single currently-playing media element across the whole feed. Any element
 * that starts playing pauses the previous one — this holds even for a manual
 * native play on a non-active card, so at most one video ever plays.
 */
let currentPlayer: HTMLVideoElement | null = null;

function claimPlayback(video: HTMLVideoElement) {
  if (currentPlayer && currentPlayer !== video && !currentPlayer.paused) {
    currentPlayer.pause();
  }
  currentPlayer = video;
}

function releasePlayback(video: HTMLVideoElement) {
  if (currentPlayer === video) currentPlayer = null;
}

/**
 * Attach media only when the parent grants metadata (active / next-1). When
 * active and at least 80% visible it plays muted; scrolling below that threshold,
 * document hidden, or unmount pauses it. Manual native play on a non-active or
 * hidden card is rejected (paused straight back) so a single video ever plays.
 * Autoplay rejections fall back silently to native controls.
 */
export function LazyClipVideo({
  src,
  active = false,
  preload = "none",
  onPlaybackStarted,
  onPlay,
  ...props
}: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visibleEnough, setVisibleEnough] = useState(false);
  const startedRef = useRef(false);
  // Keep the latest playability state readable inside async callbacks / promises.
  const stateRef = useRef({ active, visibleEnough });
  stateRef.current = { active, visibleEnough };

  // The source exists only while the parent grants metadata; otherwise it is
  // detached so the browser downloads nothing for off-window cards.
  const hasSource = preload === "metadata";

  // Track whether this card is at least 80% visible so playback follows the feed.
  useEffect(() => {
    const video = ref.current;
    if (!video || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.find((candidate) => candidate.target === video);
        if (!entry) return;
        setVisibleEnough(entry.isIntersecting && entry.intersectionRatio >= 0.8);
      },
      { threshold: [0, 0.8, 1] },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  // Only the active + >=80%-visible card with an attached source plays. Everyone
  // else pauses. A late-resolving play promise re-checks and pauses if it is no
  // longer the active card by the time it resolves.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const shouldPlay = active && visibleEnough && hasSource;
    if (shouldPlay) {
      claimPlayback(video);
      const attempt = video.play();
      if (attempt && typeof attempt.then === "function") {
        attempt.then(
          () => {
            if (!(stateRef.current.active && stateRef.current.visibleEnough)) {
              video.pause();
            }
          },
          () => {
            /* Autoplay blocked — native controls / manual play still work. */
          },
        );
      }
    } else if (!video.paused) {
      video.pause();
    }
  }, [active, visibleEnough, hasSource]);

  // Pause when the document is hidden (tab switch / background) and on unmount.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const onHidden = () => {
      if (document.visibilityState === "hidden" && !video.paused) video.pause();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      if (!video.paused) video.pause();
      releasePlayback(video);
    };
  }, []);

  const handlePlay = useCallback<React.ReactEventHandler<HTMLVideoElement>>(
    (event) => {
      const video = event.currentTarget;
      // Reject a manual native play on a card that is not the active, visible one:
      // pause it straight back and never count it, so only one video plays.
      if (!(stateRef.current.active && stateRef.current.visibleEnough) || document.visibilityState === "hidden") {
        video.pause();
        return;
      }
      claimPlayback(video);
      if (!startedRef.current) {
        startedRef.current = true;
        onPlaybackStarted?.();
      }
      onPlay?.(event);
    },
    [onPlay, onPlaybackStarted],
  );

  // Preload/attach media only when the parent grants metadata. The poster is an
  // independent JPEG and never triggers a media resource download.
  return (
    <video
      {...props}
      ref={ref}
      controls
      playsInline
      autoPlay={false}
      preload={preload}
      onPlay={handlePlay}
      data-src={src}
      data-active={active ? "true" : "false"}
      src={hasSource ? src : undefined}
    />
  );
}
