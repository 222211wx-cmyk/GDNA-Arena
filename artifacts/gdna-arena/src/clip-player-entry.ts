import { tokens } from "@workspace/gdna-ds/tokens";

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
    h1,p{margin-block:calc(${space} * 2)}button{font:inherit;color:${palette.primaryForeground};background:${palette.primary};border:1px solid ${palette.input};border-radius:${tokens.radius};padding:calc(${space} * 3);cursor:pointer;font-weight:700}
    video,audio{inline-size:100%;max-block-size:72vh;background:${palette.background}}a{color:${palette.primary}}.muted{color:${palette.mutedForeground}}.error{color:${palette.destructive}}[hidden]{display:none!important}
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

export function renderClipPlayer(code: string) {
  const root = document.getElementById("root");
  if (!root) throw new Error("Clip root is missing");
  addStyles();
  root.innerHTML = `
    <main dir="rtl" data-testid="clip-player-shell">
      <header><h1>الكليبز</h1><a href="${BASE}clip">رجوع</a></header>
      <section>
        <p id="player-code" dir="ltr">${code}</p>
        <h1 id="player-name">جارٍ تحميل الكليب…</h1>
        <div id="player-media"></div>
        <p id="player-status" class="muted" role="status" aria-live="polite"></p>
        <p id="player-error" class="error" role="alert" aria-live="assertive"></p>
        <button id="player-retry" type="button" hidden>إعادة المحاولة</button>
      </section>
    </main>`;

  const name = document.getElementById("player-name") as HTMLHeadingElement;
  const mediaRoot = document.getElementById("player-media") as HTMLDivElement;
  const status = document.getElementById("player-status") as HTMLParagraphElement;
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