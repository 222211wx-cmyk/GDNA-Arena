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

export type SessionStatus = "checking" | "authenticated" | "anonymous" | "unavailable";

let current: SessionUser | null = null;
let lastKnownId: number | null = readLastId();
let status: SessionStatus = "checking";
let sessionError: string | null = null;
let generation = 0;
let refreshRequest = 0;
let pendingMutations = 0;
let verificationNeeded = false;
let mutationTail: Promise<void> = Promise.resolve();
const refreshControllers = new Set<AbortController>();
const listeners = new Set<(u: SessionUser | null, status: SessionStatus) => void>();

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
    if (msg.accountId !== undefined) accountChangedElsewhere(msg.accountId);
  };
}
// Fallback for browsers without BroadcastChannel: the localStorage "last-account"
// key change fires a storage event in other tabs.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== "gdna-lite:last-account") return;
    const next = e.newValue ? Number(e.newValue) : null;
    accountChangedElsewhere(next);
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
  // Close the old handle synchronously, not after deletion has awaited: a new
  // account may already have opened its own snapshot by then.
  resetSnapshotHandle();
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
}

function notify(): void {
  listeners.forEach((l) => l(current, status));
}

function setStatus(next: SessionStatus): void {
  if (status === next) return;
  status = next;
  notify();
}

function setCurrent(
  user: SessionUser | null,
  announce = true,
  forceAnnouncement = false,
  nextStatus: SessionStatus = user ? "authenticated" : "anonymous",
): void {
  const previousId = lastKnownId;
  const nextId = user?.id ?? null;
  // Account changed (or logged out): purge the previous account's private data.
  if (previousId != null && previousId !== nextId) {
    void clearAccountData(previousId);
  }
  current = user;
  lastKnownId = nextId;
  status = nextStatus;
  sessionError = null;
  if (announce) writeLastId(nextId);
  // Notify other tabs so they purge the prior account's private data too.
  if (announce && (previousId !== nextId || forceAnnouncement)) {
    try {
      channel?.postMessage({ type: "account-change", accountId: nextId });
    } catch {
      /* ignore */
    }
  }
  notify();
}

function accountChangedElsewhere(nextId: number | null): void {
  if (nextId === (current?.id ?? null) && (status === "authenticated" || status === "anonymous")) return;
  generation++;
  if (pendingMutations > 0) verificationNeeded = true;
  refreshControllers.forEach((controller) => controller.abort());
  // This is a confirmed account change from another tab, not a failed /me.
  // Hide the previous identity immediately while verifying the new cookie.
  setCurrent(null, false, false, "checking");
  void refreshSession();
}

function sessionUser(data: SessionUser): SessionUser {
  if (!data || !Number.isSafeInteger(data.id) || data.id <= 0 || typeof data.username !== "string") {
    throw new Error("Session response unavailable — please retry");
  }
  return { id: data.id, username: data.username, isAdmin: data.isAdmin };
}

function sessionChanged(): Error {
  return new Error("Session changed — please retry");
}

// Serialize credential writes so an older login response cannot set a cookie
// after logout (or after a newer login). Generation guards also cover /me JSON.
function mutateSession<T>(operation: (token: number) => Promise<T>): Promise<T> {
  const token = ++generation;
  refreshControllers.forEach((controller) => controller.abort());
  pendingMutations++;
  const result = mutationTail.then(() => operation(token)).finally(() => {
    pendingMutations--;
    if (pendingMutations === 0 && verificationNeeded) {
      verificationNeeded = false;
      // A superseded credential response may still have changed the browser's
      // cookie. Verify its actual owner instead of retaining the old identity.
      // Do not purge the old account until /me confirms logout or a new owner.
      current = null;
      status = "checking";
      sessionError = null;
      notify();
      void refreshSession();
    }
  });
  mutationTail = result.then(() => {}, () => {});
  return result;
}

export function getUser(): SessionUser | null {
  return current;
}

export function getSessionStatus(): SessionStatus {
  return status;
}

export function getSessionError(): string | null {
  return sessionError;
}

export function subscribeSession(listener: (u: SessionUser | null, status: SessionStatus) => void): () => void {
  listeners.add(listener);
  listener(current, status);
  return () => listeners.delete(listener);
}

export async function refreshSession(): Promise<SessionUser | null> {
  if (pendingMutations > 0) return current;
  const token = generation;
  const request = ++refreshRequest;
  const controller = new AbortController();
  refreshControllers.add(controller);
  const isCurrent = () => token === generation && request === refreshRequest;
  if (!current) setStatus("checking");
  try {
    const res = await fetch(apiPath("/api/auth/me"), {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!isCurrent()) return current;
    if (res.status === 401) {
      setCurrent(null);
      return null;
    }
    if (!res.ok) throw new ApiError(res.status, `Session verification unavailable (${res.status}) — please retry`);
    const data = (await res.json()) as SessionUser;
    if (!isCurrent()) return current;
    setCurrent(sessionUser(data));
    return current;
  } catch (err) {
    // 429, 5xx, network/JSON failures are NOT logout and never purge private
    // data. With no verified identity, keep a retryable unavailable state.
    if (isCurrent()) {
      sessionError = err instanceof Error ? err.message : "Session verification unavailable — please retry";
      setStatus(current ? "authenticated" : "unavailable");
    }
    return current;
  } finally {
    refreshControllers.delete(controller);
  }
}

export async function login(username: string, password: string): Promise<SessionUser> {
  return mutateSession(async (token) => {
    if (token !== generation) throw sessionChanged();
    let receivedResponse = false;
    try {
      const data = await postJson<SessionUser>("/api/auth/login", { username, password, rememberMe: true });
      receivedResponse = true;
      if (token !== generation) throw sessionChanged();
      const user = sessionUser(data);
      verificationNeeded = false;
      setCurrent(user, true, true);
      return user;
    } catch (err) {
      if (receivedResponse || err instanceof SyntaxError) verificationNeeded = true;
      if (token === generation && !current && status === "checking") {
        sessionError = err instanceof Error ? err.message : "Sign-in unavailable — please retry";
        setStatus("unavailable");
      }
      throw err;
    }
  });
}

export async function logout(): Promise<void> {
  // Explicit logout clears local private state immediately, without announcing
  // a server logout before its revocation request has actually succeeded.
  const result = mutateSession(async (token) => {
    try {
      await postJson<void>("/api/auth/logout", {});
      if (token !== generation) {
        verificationNeeded = true;
        throw sessionChanged();
      }
      verificationNeeded = false;
      setCurrent(null, true, true);
    } catch (err) {
      if (token === generation) {
        sessionError = err instanceof Error ? err.message : "Logout unavailable — please retry";
        setStatus("unavailable");
      }
      throw err;
    }
  });
  setCurrent(null, false, false, "checking");
  return result;
}
