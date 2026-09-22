/**
 * Shared same-origin auth session. Lite reuses the React app's cookie session via
 * /api/auth/me, /api/auth/login, /api/auth/logout. On any account change (login,
 * logout, or a different id than last seen) all private Lite state is cleared:
 * the offline queue and snapshot databases for the previous account are destroyed.
 */
import { apiPath, postJson, ApiError, resetSnapshotHandle } from "./api";
import { OfflineQueue } from "./offline-queue";
import { deleteDb } from "./idb";

export interface SessionUser {
  id: number;
  username: string;
  isAdmin?: boolean;
}

let current: SessionUser | null = null;
let lastKnownId: number | null = readLastId();
const listeners = new Set<(u: SessionUser | null) => void>();

const CHANNEL = "gdna-lite:account";
const channel: BroadcastChannel | null =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;

// Cross-tab account changes: if another tab logs in/out or switches accounts, this
// tab purges the previous account's private data and re-derives its session so no
// offline snapshot or queued ciphertext leaks across the switch.
if (channel) {
  channel.onmessage = (e: MessageEvent) => {
    const msg = e.data as { type?: string; accountId?: number | null } | undefined;
    if (msg?.type !== "account-change") return;
    if (msg.accountId === (current?.id ?? null)) return;
    void refreshSession();
  };
}
// Fallback for browsers without BroadcastChannel: the localStorage "last-account"
// key change fires a storage event in other tabs.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== "gdna-lite:last-account") return;
    const next = e.newValue ? Number(e.newValue) : null;
    if (next !== (current?.id ?? null)) void refreshSession();
  });
}

function readLastId(): number | null {
  try {
    const raw = localStorage.getItem("gdna-lite:last-account");
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function writeLastId(id: number | null): void {
  try {
    if (id == null) localStorage.removeItem("gdna-lite:last-account");
    else localStorage.setItem("gdna-lite:last-account", String(id));
  } catch {
    /* ignore */
  }
}

async function clearAccountData(accountId: number): Promise<void> {
  try {
    await OfflineQueue.destroy(accountId);
  } catch {
    /* ignore */
  }
  try {
    await deleteDb(`gdna-lite-snapshot:${accountId}`);
  } catch {
    /* ignore */
  }
  resetSnapshotHandle();
}

function setCurrent(user: SessionUser | null): void {
  const previousId = lastKnownId;
  const nextId = user?.id ?? null;
  // Account changed (or logged out): purge the previous account's private data.
  if (previousId != null && previousId !== nextId) {
    void clearAccountData(previousId);
  }
  current = user;
  lastKnownId = nextId;
  writeLastId(nextId);
  // Notify other tabs so they purge the prior account's private data too.
  if (previousId !== nextId) {
    try {
      channel?.postMessage({ type: "account-change", accountId: nextId });
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l(user));
}

export function getUser(): SessionUser | null {
  return current;
}

export function subscribeSession(listener: (u: SessionUser | null) => void): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

export async function refreshSession(): Promise<SessionUser | null> {
  try {
    const res = await fetch(apiPath("/api/auth/me"), {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      setCurrent(null);
      return null;
    }
    const data = (await res.json()) as SessionUser;
    setCurrent({ id: data.id, username: data.username, isAdmin: data.isAdmin });
    return current;
  } catch {
    // Network failure: keep any known user but do not fabricate one.
    return current;
  }
}

export async function login(username: string, password: string): Promise<SessionUser> {
  const data = await postJson<SessionUser>("/api/auth/login", { username, password });
  setCurrent({ id: data.id, username: data.username, isAdmin: data.isAdmin });
  return current!;
}

export async function logout(): Promise<void> {
  try {
    await postJson<void>("/api/auth/logout", {});
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  setCurrent(null);
}
