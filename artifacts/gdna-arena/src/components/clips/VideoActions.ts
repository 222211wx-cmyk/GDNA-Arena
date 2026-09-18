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

function button(label: string, icon: string) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "clip-action";
  control.setAttribute("aria-label", label);
  control.innerHTML = `<span aria-hidden="true">${icon}</span><span>${label}</span>`;
  return control;
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
  shell.innerHTML = `<div class="video-actions" role="toolbar" aria-label="Clip actions"></div>
    <p class="action-status muted" role="status" aria-live="polite"></p>
    <div class="clip-comments" hidden></div>`;
  options.host.replaceChildren(shell);
  const toolbar = shell.querySelector(".video-actions") as HTMLDivElement;
  const status = shell.querySelector(".action-status") as HTMLParagraphElement;
  const comments = shell.querySelector(".clip-comments") as HTMLDivElement;

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

  const heart = button(current.liked ? "Unlike" : "Like", current.liked ? "♥" : "♡");
  const heartCount = document.createElement("strong");
  heartCount.textContent = String(current.likeCount);
  heart.append(heartCount);
  heart.classList.toggle("active", current.liked);
  heart.addEventListener("click", async () => {
    heart.disabled = true;
    try {
      const data = await apiJson(`/clips/${current.id}/like`, { method: "POST" });
      current.liked = Boolean(data.liked);
      current.likeCount = Number(data.likeCount);
      heart.classList.toggle("active", current.liked);
      heart.setAttribute("aria-label", current.liked ? "Unlike" : "Like");
      (heart.children[0] as HTMLElement).textContent = current.liked ? "♥" : "♡";
      (heart.children[1] as HTMLElement).textContent = current.liked ? "Unlike" : "Like";
      heartCount.textContent = String(current.likeCount);
      showMessage(status, current.liked ? "Liked" : "Like removed");
    } catch (error) {
      showMessage(status, error instanceof Error ? error.message : "Unable to update like", true);
    } finally {
      heart.disabled = false;
    }
  });

  const commentButton = button("Comments", "💬");
  const commentCount = document.createElement("strong");
  commentCount.textContent = String(current.commentCount);
  commentButton.append(commentCount);
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
        commentCount.textContent = String(current.commentCount);
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
  const share = button("Share", "↗");
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
  const copy = button("Copy link", "⧉");
  copy.addEventListener("click", async () => {
    if (await copyLink(shareUrl)) showMessage(status, "Link copied");
    else showSelectableLink(status, shareUrl);
  });

  const message = button("Message", "✉");
  if (current.isOwner) message.hidden = true;
  message.addEventListener("click", async () => {
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

  const zoom = button("Zoom", "⌕");
  zoom.addEventListener("click", () => {
    const zoomed = options.media.classList.toggle("clip-zoomed");
    zoom.classList.toggle("active", zoomed);
    zoom.setAttribute("aria-pressed", String(zoomed));
  });
  const fullscreen = button("Fullscreen", "⛶");
  fullscreen.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (options.media.requestFullscreen) await options.media.requestFullscreen();
      else if ("webkitEnterFullscreen" in options.media) (options.media as HTMLVideoElement & { webkitEnterFullscreen(): void }).webkitEnterFullscreen();
    } catch { showMessage(status, "Fullscreen is unavailable", true); }
  });
  toolbar.append(heart, commentButton, share, copy, message, zoom, fullscreen);

  if (current.isOwner) {
    const edit = button("Edit title", "✎");
    edit.addEventListener("click", () => {
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
          document.title = `${current.title} — HELIXLY`;
          showMessage(status, "Title saved");
        } catch (error) {
          save.disabled = false;
          showMessage(status, error instanceof Error ? error.message : "Unable to save title", true);
        }
      });
    });
    toolbar.append(edit);
  }
}