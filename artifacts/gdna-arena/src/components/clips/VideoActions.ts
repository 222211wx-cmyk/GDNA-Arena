import { icons } from "./clipIcons";
import { isClipSaved, toggleClipSaved } from "./savedClips";

const BASE = import.meta.env.BASE_URL;

export type VideoActionState = {
  id: number;
  code?: string | null;
  title: string;
  author: { id: number; username: string };
  isOwner: boolean;
  liked: boolean;
  likeCount: number;
  commentCount: number;
};

type MountOptions = {
  host: HTMLElement;
  media: HTMLMediaElement;
  titleElement: HTMLElement;
  initial?: VideoActionState;
  clipId: number;
  code?: string | null;
  /** Viewer account id used to scope local (device-only) saves. */
  accountId?: number | string | null;
  /**
   * Disable the bookmark control entirely. Used when the identity lookup failed
   * for a reason other than 401, so we must not write to the anonymous bucket
   * under an account that may actually be signed in.
   */
  saveDisabled?: boolean;
  /** Content type label shown next to the audio/video badge. */
  contentType?: string | null;
};

async function apiJson(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}api${path}`, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : `Request failed (${response.status})`);
  return body;
}

/** Vertical rail icon button. Icon SVG stays; label is aria-only + count text. */
function railButton(label: string, iconHtml: string): HTMLButtonElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "clip-rail-btn";
  control.setAttribute("aria-label", label);
  const iconWrap = document.createElement("span");
  iconWrap.className = "clip-rail-icon";
  iconWrap.innerHTML = iconHtml;
  control.append(iconWrap);
  return control;
}

/** Menu item inside the three-dot popover. */
function menuItem(label: string, iconHtml: string): HTMLButtonElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "clip-menu-item";
  control.setAttribute("role", "menuitem");
  const iconWrap = document.createElement("span");
  iconWrap.className = "clip-menu-icon";
  iconWrap.innerHTML = iconHtml;
  iconWrap.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = label;
  control.append(iconWrap, text);
  control.setAttribute("aria-label", label);
  return control;
}

function setCount(control: HTMLButtonElement, value: number) {
  let count = control.querySelector<HTMLElement>(".clip-rail-count");
  if (!count) {
    count = document.createElement("strong");
    count.className = "clip-rail-count";
    control.append(count);
  }
  count.textContent = String(value);
}

function showMessage(status: HTMLElement, message: string, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

async function copyLink(url: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {
    // Clipboard permissions/focus rules vary by browser; try the legacy path.
  }
  const textarea = document.createElement("textarea");
  textarea.value = url;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.cssText = "position:fixed;inset-inline-start:-9999px;opacity:0";
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  let copied = false;
  try {
    copied = typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textarea.remove();
  }
  return copied;
}

function showSelectableLink(status: HTMLElement, url: string) {
  const label = document.createElement("span");
  label.textContent = "Copy this link: ";
  const input = document.createElement("input");
  input.type = "text";
  input.readOnly = true;
  input.value = url;
  input.className = "copy-link-fallback";
  input.setAttribute("aria-label", "Share link");
  input.addEventListener("focus", () => input.select());
  input.addEventListener("click", () => input.select());
  status.classList.remove("error");
  status.replaceChildren(label, input);
  input.focus();
  input.select();
}

export async function mountVideoActions(options: MountOptions): Promise<void> {
  let state = options.initial;
  const shell = document.createElement("div");
  shell.className = "video-actions-shell";
  shell.innerHTML = `
    <div class="clip-overlay">
      <div class="clip-rail" role="toolbar" aria-label="Clip actions" aria-orientation="vertical"></div>
      <div class="clip-meta">
        <div class="clip-meta-author"></div>
        <p class="clip-meta-title"></p>
        <p class="clip-meta-audio"></p>
      </div>
    </div>
    <p class="action-status muted" role="status" aria-live="polite"></p>
    <div class="clip-comments" hidden></div>`;
  options.host.replaceChildren(shell);
  const overlay = shell.querySelector(".clip-overlay") as HTMLDivElement;
  const rail = overlay.querySelector(".clip-rail") as HTMLDivElement;
  const metaAuthor = overlay.querySelector(".clip-meta-author") as HTMLDivElement;
  const metaTitle = overlay.querySelector(".clip-meta-title") as HTMLParagraphElement;
  const metaAudio = overlay.querySelector(".clip-meta-audio") as HTMLParagraphElement;
  const status = shell.querySelector(".action-status") as HTMLParagraphElement;
  const comments = shell.querySelector(".clip-comments") as HTMLDivElement;
  // Video: the rail/meta overlay floats over the media, so relocate it into the
  // media's (position:relative) frame. Audio has no picture, so its rail/meta
  // stay in the host as a static block below the native controls (no overlay).
  const audioLayout = options.media instanceof HTMLAudioElement ||
    (options.contentType ?? "").startsWith("audio/");
  overlay.classList.toggle("clip-overlay-static", audioLayout);
  const mediaFrame = options.media.parentElement;
  if (!audioLayout && mediaFrame) mediaFrame.appendChild(overlay);

  try {
    if (!state) {
      const data = await apiJson(`/clips/${options.clipId}/engagement`);
      state = data.engagement as VideoActionState;
    }
  } catch (error) {
    showMessage(status, error instanceof Error ? error.message : "Actions unavailable", true);
    return;
  }
  const current = state;

  // ── Left-bottom meta: author profile link, title, audio/media label ──
  // Real profile link (the app routes /citizen/:username); not a fake avatar.
  const authorLink = document.createElement("a");
  authorLink.className = "clip-meta-author-link";
  authorLink.href = `${BASE}citizen/${encodeURIComponent(current.author.username)}`;
  authorLink.textContent = `@${current.author.username}`;
  authorLink.setAttribute("aria-label", `Open ${current.author.username}'s profile`);
  metaAuthor.replaceChildren(authorLink);
  metaTitle.textContent = current.title;
  // Both video and audio clips show the "Original audio" caption line
  // (no invented artist metadata).
  metaAudio.textContent = "Original audio";

  // ── Heart (like) ─────────────────────────────────────────────────────
  const heart = railButton(current.liked ? "Unlike" : "Like", icons.heart(current.liked));
  setCount(heart, current.likeCount);
  heart.classList.toggle("active", current.liked);
  const renderHeart = () => {
    const iconWrap = heart.querySelector(".clip-rail-icon");
    if (iconWrap) iconWrap.innerHTML = icons.heart(current.liked);
    heart.classList.toggle("active", current.liked);
    heart.setAttribute("aria-label", current.liked ? "Unlike" : "Like");
    setCount(heart, current.likeCount);
  };
  heart.addEventListener("click", async () => {
    heart.disabled = true;
    try {
      const data = await apiJson(`/clips/${current.id}/like`, { method: "POST" });
      current.liked = Boolean(data.liked);
      current.likeCount = Number(data.likeCount);
      renderHeart();
      showMessage(status, current.liked ? "Liked" : "Like removed");
    } catch (error) {
      showMessage(status, error instanceof Error ? error.message : "Unable to update like", true);
    } finally {
      heart.disabled = false;
    }
  });

  // ── Comment ──────────────────────────────────────────────────────────
  const commentButton = railButton("Comments", icons.comment());
  setCount(commentButton, current.commentCount);
  let commentsLoaded = false;
  const loadComments = async () => {
    const data = await apiJson(`/clips/${current.id}/comments`);
    const list = document.createElement("div");
    list.className = "comment-list";
    const items = Array.isArray(data.comments) ? data.comments : [];
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No comments yet.";
      list.append(empty);
    } else {
      for (const item of items) {
        const row = document.createElement("p");
        const author = document.createElement("strong");
        author.textContent = `${item.username}: `;
        row.append(author, document.createTextNode(String(item.content)));
        list.append(row);
      }
    }
    const form = document.createElement("form");
    form.className = "comment-form";
    const input = document.createElement("input");
    input.name = "content";
    input.maxLength = 500;
    input.required = true;
    input.placeholder = "Write a comment…";
    input.setAttribute("aria-label", "Comment");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Post";
    form.append(input, submit);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      submit.disabled = true;
      try {
        await apiJson(`/clips/${current.id}/comments`, {
          method: "POST",
          body: JSON.stringify({ content: input.value }),
        });
        input.value = "";
        current.commentCount++;
        setCount(commentButton, current.commentCount);
        commentsLoaded = false;
        await loadComments();
      } catch (error) {
        showMessage(status, error instanceof Error ? error.message : "Unable to post comment", true);
      } finally {
        submit.disabled = false;
      }
    });
    comments.replaceChildren(list, form);
    commentsLoaded = true;
  };
  commentButton.addEventListener("click", async () => {
    comments.hidden = !comments.hidden;
    commentButton.setAttribute("aria-expanded", String(!comments.hidden));
    if (!comments.hidden && !commentsLoaded) {
      try { await loadComments(); }
      catch (error) { showMessage(status, error instanceof Error ? error.message : "Unable to load comments", true); }
    }
  });

  const shareUrl = current.code
    ? new URL(`${BASE}clip/${current.code}`, window.location.origin).href
    : `${window.location.origin}${BASE}clip#clip-${current.id}`;

  // ── Share ────────────────────────────────────────────────────────────
  const share = railButton("Share", icons.share());
  share.addEventListener("click", async () => {
    try {
      if (navigator.share) await navigator.share({ title: current.title, url: shareUrl });
      else {
        if (await copyLink(shareUrl)) showMessage(status, "Link copied");
        else showSelectableLink(status, shareUrl);
      }
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError") showMessage(status, "Unable to share", true);
    }
  });

  // ── Bookmark / Save (local, device-only) ─────────────────────────────
  let saved = options.saveDisabled ? false : isClipSaved(options.accountId ?? null, current.id);
  const bookmark = railButton(saved ? "Saved on this device" : "Save on this device", icons.bookmark(saved));
  bookmark.setAttribute("aria-pressed", String(saved));
  bookmark.classList.toggle("active", saved);
  if (options.saveDisabled) {
    // Identity could not be resolved (non-401), so scoping a save is unsafe.
    bookmark.disabled = true;
    bookmark.setAttribute("aria-label", "Saving unavailable — sign-in status unknown");
  }
  bookmark.addEventListener("click", () => {
    if (options.saveDisabled) return;
    const next = toggleClipSaved(options.accountId ?? null, current.id);
    if (next === null) {
      showMessage(status, "Saving is unavailable on this device", true);
      return;
    }
    saved = next;
    const iconWrap = bookmark.querySelector(".clip-rail-icon");
    if (iconWrap) iconWrap.innerHTML = icons.bookmark(saved);
    bookmark.classList.toggle("active", saved);
    bookmark.setAttribute("aria-pressed", String(saved));
    bookmark.setAttribute("aria-label", saved ? "Saved on this device" : "Save on this device");
    showMessage(status, saved ? "Saved on this device" : "Removed from saved");
  });

  // ── Three-dot menu (secondary actions) ───────────────────────────────
  const menuWrap = document.createElement("div");
  menuWrap.className = "clip-menu-wrap";
  const more = railButton("More actions", icons.more());
  more.setAttribute("aria-haspopup", "menu");
  more.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div");
  menu.className = "clip-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "More clip actions");
  menu.hidden = true;
  menuWrap.append(more, menu);

  const closeMenu = () => {
    if (menu.hidden) return;
    menu.hidden = true;
    more.setAttribute("aria-expanded", "false");
  };
  const openMenu = () => {
    menu.hidden = false;
    more.setAttribute("aria-expanded", "true");
    const first = menu.querySelector<HTMLButtonElement>("button:not([hidden])");
    first?.focus();
  };
  more.addEventListener("click", () => {
    if (menu.hidden) openMenu();
    else closeMenu();
  });
  document.addEventListener("click", event => {
    if (!menuWrap.contains(event.target as Node)) closeMenu();
  });
  menu.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeMenu();
      more.focus();
    }
  });

  // Copy link (menu)
  const copy = menuItem("Copy link", icons.link());
  copy.addEventListener("click", async () => {
    closeMenu();
    if (await copyLink(shareUrl)) showMessage(status, "Link copied");
    else showSelectableLink(status, shareUrl);
  });
  menu.append(copy);

  // Message (menu) — not for owner
  const message = menuItem("Message", icons.message());
  if (current.isOwner) message.hidden = true;
  message.addEventListener("click", async () => {
    closeMenu();
    message.disabled = true;
    try {
      const data = await apiJson("/messages/rooms", {
        method: "POST",
        body: JSON.stringify({ targetUsername: current.author.username, type: "direct" }),
      });
      if (!data?.room?.id) throw new Error("Messenger room was not returned");
      window.location.assign(`${BASE}messages?room=${encodeURIComponent(data.room.id)}`);
    } catch (error) {
      showMessage(status, error instanceof Error ? error.message : "Unable to open messages", true);
      message.disabled = false;
    }
  });
  menu.append(message);

  // Zoom (menu)
  const zoom = menuItem("Zoom", icons.zoom());
  zoom.addEventListener("click", () => {
    const zoomed = options.media.classList.toggle("clip-zoomed");
    zoom.classList.toggle("active", zoomed);
    zoom.setAttribute("aria-pressed", String(zoomed));
    showMessage(status, zoomed ? "Zoomed in" : "Zoom reset");
  });
  menu.append(zoom);

  // Fullscreen (menu)
  const fullscreen = menuItem("Fullscreen", icons.fullscreen());
  fullscreen.addEventListener("click", async () => {
    closeMenu();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (options.media.requestFullscreen) await options.media.requestFullscreen();
      else if ("webkitEnterFullscreen" in options.media) (options.media as HTMLVideoElement & { webkitEnterFullscreen(): void }).webkitEnterFullscreen();
    } catch { showMessage(status, "Fullscreen is unavailable", true); }
  });
  menu.append(fullscreen);

  // Edit title (menu) — owner only
  if (current.isOwner) {
    const edit = menuItem("Edit title", icons.edit());
    edit.addEventListener("click", () => {
      closeMenu();
      const form = document.createElement("form");
      form.className = "title-edit";
      const input = document.createElement("input");
      input.value = current.title;
      input.maxLength = 120;
      input.required = true;
      input.setAttribute("aria-label", "Clip title");
      const save = document.createElement("button");
      save.type = "submit";
      save.textContent = "Save";
      form.append(input, save);
      options.titleElement.replaceChildren(form);
      input.focus();
      input.select();
      form.addEventListener("submit", async event => {
        event.preventDefault();
        save.disabled = true;
        try {
          const data = await apiJson(`/clips/${current.id}`, {
            method: "PATCH",
            body: JSON.stringify({ title: input.value }),
          });
          current.title = String(data.clip.title);
          options.titleElement.textContent = current.title;
          metaTitle.textContent = current.title;
          document.title = `${current.title} — HELIXLY`;
          showMessage(status, "Title saved");
        } catch (error) {
          save.disabled = false;
          showMessage(status, error instanceof Error ? error.message : "Unable to save title", true);
        }
      });
    });
    menu.append(edit);
  }

  // Rail order: heart, comment, share, bookmark/save, three-dots.
  rail.append(heart, commentButton, share, bookmark, menuWrap);
}
