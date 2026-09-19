import { tokens } from "@workspace/gdna-ds/tokens";
import { mountVideoActions, type VideoActionState } from "./components/clips/VideoActions";
import { clipOverlayCss } from "./components/clips/clipOverlayStyles";

const BASE = import.meta.env.BASE_URL;
const FETCH_TIMEOUT_MS = 12_000;
const POLL_DELAY_MS = 4_000;
const MAX_AUTOMATIC_POLLS = 30;

type ClipByCode = {
  code: string;
  name: string;
  originalName: string;
  duration: number;
  size: number;
  created_at: string;
  contentType: string;
  processingStatus: string;
  url: string | null;
  id: number;
  author: { id: number; username: string; avatarUrl?: string | null };
  isOwner: boolean;
  liked: boolean;
  likeCount: number;
  commentCount: number;
  saved?: boolean;
  saveCount?: number;
  shareCount?: number;
};

const palette = tokens.color.dark;
const space = tokens.spacing;

function addStyles() {
  const style = document.createElement("style");
  style.textContent = `
    :root{color-scheme:dark;font-family:${tokens.fontFamily.sans.join(",")};background:${palette.background};color:${palette.foreground}}
    *{box-sizing:border-box}body{margin:0;background:${palette.background};color:${palette.foreground}}
    main{padding:calc(${space} * 4);margin:auto;max-width:48rem}header{display:flex;align-items:center;justify-content:space-between}
    section{display:grid;gap:calc(${space} * 3);padding:calc(${space} * 4);margin-block:calc(${space} * 4);background:${palette.card};border:1px solid ${palette.border};border-radius:${tokens.radius}}
    h1,p{margin-block:calc(${space} * 2)}button,input{font:inherit;color:${palette.foreground};background:${palette.secondary};border:1px solid ${palette.input};border-radius:${tokens.radius};padding:calc(${space} * 3)}
    button{cursor:pointer;font-weight:700}button:disabled{opacity:.55}
    .comment-form,.title-edit{display:flex;gap:calc(${space} * 2)}.comment-form input,.title-edit input{min-inline-size:0;flex:1}
    .copy-link-fallback{inline-size:min(100%,28rem)}
    video,audio{inline-size:100%;max-block-size:72vh;background:${palette.background};display:block}.clip-zoomed{transform:scale(1.35);transform-origin:center;position:relative;z-index:2}
    #player-media{overflow:hidden;position:relative;border-radius:${tokens.radius}}
    ${clipOverlayCss(palette, space)}
    a{color:${palette.primary}}.muted{color:${palette.mutedForeground}}.error{color:${palette.destructive}}[hidden]{display:none!important}
  `;
  document.head.append(style);
}

async function fetchClip(code: string, signal: AbortSignal): Promise<ClipByCode> {
  const response = await fetch(`${BASE}api/clip/by-code/${encodeURIComponent(code)}`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    let message = `تعذر فتح الكليب (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // Keep status-based error.
    }
    throw new Error(message);
  }
  const body = await response.json();
  if (!body?.clip || body.clip.code !== code) throw new Error("بيانات الكليب غير صالحة");
  return body.clip as ClipByCode;
}

function configureMediaSession(clip: ClipByCode, media: HTMLMediaElement) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: clip.name,
    artist: "HELIXLY",
    album: clip.code,
  });
  const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    ["play", () => { void media.play(); }],
    ["pause", () => media.pause()],
    ["seekbackward", details => {
      media.currentTime = Math.max(0, media.currentTime - (details.seekOffset ?? 10));
    }],
    ["seekforward", details => {
      media.currentTime = Math.min(media.duration || Infinity, media.currentTime + (details.seekOffset ?? 10));
    }],
    ["seekto", details => {
      if (details.seekTime !== undefined) media.currentTime = details.seekTime;
    }],
  ];
  for (const [action, handler] of actions) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Unsupported action. */ }
  }
}

const IDENTITY_TIMEOUT_MS = 8_000;

type Identity =
  | { status: "authenticated"; accountId: number }
  | { status: "anonymous" }
  | { status: "unknown" };

/**
 * Resolve the viewer identity with a bounded timeout. Only a 401 confirms an
 * anonymous viewer (safe to scope saves to the anonymous bucket). Any other
 * failure (network/timeout/5xx) returns "unknown" so the caller disables saving
 * instead of writing a logged-in user's save into the anonymous bucket.
 */
async function resolveIdentity(): Promise<Identity> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), IDENTITY_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}api/auth/me`, {
      credentials: "include", cache: "no-store", signal: controller.signal,
    });
    if (response.status === 401) return { status: "anonymous" };
    if (!response.ok) return { status: "unknown" };
    const me = await response.json().catch(() => null);
    if (me && Number.isSafeInteger(me.id)) return { status: "authenticated", accountId: me.id };
    return { status: "unknown" };
  } catch {
    return { status: "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

export function renderClipPlayer(code: string) {
  const root = document.getElementById("root");
  if (!root) throw new Error("Clip root is missing");
  addStyles();
  // Start identity resolution immediately, but the video may render before it
  // settles; we await it right before mounting actions to avoid a save race.
  const identityPromise = resolveIdentity();
  root.innerHTML = `
    <main dir="rtl" data-testid="clip-player-shell">
      <header><h1>الكليبز</h1><a href="${BASE}clip">رجوع</a></header>
      <section>
        <p id="player-code" dir="ltr">${code}</p>
        <h1 id="player-name">جارٍ تحميل الكليب…</h1>
        <div id="player-media"></div>
        <div id="player-actions"></div>
        <p id="player-status" class="muted" role="status" aria-live="polite"></p>
        <p id="player-error" class="error" role="alert" aria-live="assertive"></p>
        <button id="player-retry" type="button" hidden>إعادة المحاولة</button>
      </section>
    </main>`;

  const name = document.getElementById("player-name") as HTMLHeadingElement;
  const mediaRoot = document.getElementById("player-media") as HTMLDivElement;
  const status = document.getElementById("player-status") as HTMLParagraphElement;
  const actions = document.getElementById("player-actions") as HTMLDivElement;
  const error = document.getElementById("player-error") as HTMLParagraphElement;
  const retry = document.getElementById("player-retry") as HTMLButtonElement;
  let loadController: AbortController | null = null;

  const load = async () => {
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    retry.hidden = true;
    error.textContent = "";
    mediaRoot.replaceChildren();
    actions.replaceChildren();
    let polls = 0;
    try {
      while (!controller.signal.aborted) {
        const timeout = window.setTimeout(
          () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
          FETCH_TIMEOUT_MS,
        );
        let clip: ClipByCode;
        try {
          clip = await fetchClip(code, controller.signal);
        } finally {
          clearTimeout(timeout);
        }
        name.textContent = clip.name || clip.originalName || clip.code;
        if (clip.url) {
          const media = document.createElement(clip.contentType.startsWith("audio/") ? "audio" : "video");
          media.controls = true;
          media.preload = "metadata";
          if (media instanceof HTMLVideoElement) media.playsInline = true;
          media.src = clip.url;
          mediaRoot.replaceChildren(media);
          status.textContent = "التشغيل في الخلفية أو مع قفل الشاشة يعتمد على نظام الهاتف والمتصفح.";
          configureMediaSession(clip, media);
          // Wait for identity before mounting actions so device-only saves are
          // scoped correctly (or disabled when identity is unknown).
          const identity = await identityPromise;
          await mountVideoActions({
            host: actions,
            media,
            titleElement: name,
            clipId: clip.id,
            code: clip.code,
            accountId: identity.status === "authenticated" ? identity.accountId : null,
            saveDisabled: identity.status === "unknown",
            contentType: clip.contentType,
            initial: {
              id: clip.id,
              code: clip.code,
              title: clip.name,
              author: clip.author,
              isOwner: clip.isOwner,
              liked: clip.liked,
              likeCount: clip.likeCount,
              commentCount: clip.commentCount,
              saved: clip.saved,
              saveCount: clip.saveCount,
              shareCount: clip.shareCount,
            } satisfies VideoActionState,
          });
          document.title = `${name.textContent} — HELIXLY`;
          return;
        }
        if (++polls >= MAX_AUTOMATIC_POLLS) {
          throw new Error("الكليب ما زال قيد التجهيز. أعد المحاولة بعد قليل.");
        }
        status.textContent = `جارٍ تجهيز الكليب… ${clip.processingStatus || ""}`;
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(resolve, POLL_DELAY_MS);
          controller.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(controller.signal.reason);
          }, { once: true });
        });
      }
    } catch (cause) {
      if (loadController !== controller || controller.signal.aborted &&
        controller.signal.reason?.name === "AbortError") return;
      status.textContent = "";
      error.textContent = cause instanceof Error ? cause.message : "تعذر فتح الكليب";
      retry.hidden = false;
    }
  };
  retry.addEventListener("click", () => void load());
  document.body.dataset.clipReady = "true";
  void load();
}