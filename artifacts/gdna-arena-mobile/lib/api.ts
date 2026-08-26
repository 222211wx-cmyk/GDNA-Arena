/**
 * GDNA Arena API client for React Native.
 * Handles cookie-based session auth by storing the session cookie in native
 * encrypted secure storage.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const SESSION_KEY = 'gdna.session.cookie';

export function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}/api`;
  // Fallback for local dev
  return 'http://localhost:3000/api';
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

let sessionCookie: string | null = null;
let sessionGeneration = 0;
let sessionStorageQueue: Promise<void> = Promise.resolve();

const sessionStorage = {
  async get(): Promise<string | null> {
    if (Platform.OS === 'web') {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(SESSION_KEY);
    }
    return SecureStore.getItemAsync(SESSION_KEY);
  },
  async set(value: string): Promise<void> {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(SESSION_KEY, value);
      return;
    }
    await SecureStore.setItemAsync(SESSION_KEY, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async delete(): Promise<void> {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(SESSION_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },
};

function serializeSessionStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = sessionStorageQueue.then(operation, operation);
  sessionStorageQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function loadSessionCookie(): Promise<void> {
  const expectedGeneration = sessionGeneration;
  await serializeSessionStorage(async () => {
    const stored = await sessionStorage.get();
    if (expectedGeneration === sessionGeneration) sessionCookie = stored;
  });
}

export async function saveSessionCookie(
  cookie: string,
  expectedGeneration = sessionGeneration,
): Promise<boolean> {
  // A login response from a request started before logout/account-switch must
    // never resurrect that previous session in secure storage.
  if (expectedGeneration !== sessionGeneration) return false;
  return serializeSessionStorage(async () => {
    if (expectedGeneration !== sessionGeneration) return false;
    await sessionStorage.set(cookie);
    if (expectedGeneration !== sessionGeneration) {
      // Logout/account-switch happened while the write was in flight.
      await sessionStorage.delete();
      return false;
    }
    sessionCookie = cookie;
    return true;
  });
}

export async function clearSessionCookie(): Promise<void> {
  // Increment synchronously so already-running requests are stale before the
  // asynchronous storage deletion yields.
  sessionGeneration += 1;
  sessionCookie = null;
  await serializeSessionStorage(() => sessionStorage.delete());
}

export function beginSessionTransition(): void {
  // Invalidate stale storage writes without discarding the current cookie.
  // Login/register must still send it once so the server can rotate and revoke
  // the prior HTTP session (and its authenticated WebSockets).
  sessionGeneration += 1;
}

export function getHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  if (sessionCookie) {
    h['Cookie'] = sessionCookie;
  }
  return h;
}

function extractCookie(response: Response): string | null {
  // React Native exposes Set-Cookie via headers.get
  const raw = response.headers.get('set-cookie');
  if (!raw) return null;
  // grab just the cookie name=value before the first semicolon
  return raw.split(';')[0].trim();
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function apiRequest<TResponse, TBody = never>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: TBody,
): Promise<TResponse> {
  const requestGeneration = sessionGeneration;
  const res = await fetch(`${getApiBase()}${path}`, {
    method,
    headers: getHeaders(),
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookie = extractCookie(res);
  if (cookie?.includes('connect.sid')) await saveSessionCookie(cookie, requestGeneration);
  return parseResponse<TResponse>(res);
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'GET',
    headers: getHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body?.error ?? res.statusText);
  }
  return res.json();
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const requestGeneration = sessionGeneration;
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'POST',
    headers: getHeaders(),
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Capture session cookie on auth endpoints
  const cookie = extractCookie(res);
  if (cookie && cookie.includes('connect.sid')) {
    await saveSessionCookie(cookie, requestGeneration);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errBody?.error ?? res.statusText);
  }
  return res.json();
}

export const apiPut = <TResponse, TBody>(path: string, body: TBody) =>
  apiRequest<TResponse, TBody>('PUT', path, body);
export const apiPatch = <TResponse, TBody>(path: string, body: TBody) =>
  apiRequest<TResponse, TBody>('PATCH', path, body);
export const apiDelete = <TResponse = void>(path: string) =>
  apiRequest<TResponse>('DELETE', path);

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const headers = getHeaders();
  delete headers['Content-Type'];
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'POST', headers, credentials: 'include', body: form,
  });
  return parseResponse<T>(res);
}

export function createAuthenticatedWebSocket(): WebSocket {
  const url = getApiBase().replace(/^http/, 'ws').replace(/\/api$/, '/api/ws');
  const options = sessionCookie ? { headers: { Cookie: sessionCookie } } : undefined;
  const NativeWebSocket = WebSocket as unknown as new (
    address: string, protocols?: string | string[], options?: { headers?: Record<string, string> },
  ) => WebSocket;
  return new NativeWebSocket(url, undefined, options);
}

// Types
export interface AuthUser {
  id: number;
  username: string;
  balance: number;
  xp: number;
  gamesPlayed: number;
  wins: number;
  canClaimDaily: boolean;
  isAdult: boolean | null;
}

export interface LeaderboardPlayer {
  id: number;
  username: string;
  balance: number;
  wins: number;
  gamesPlayed: number;
  xp: number;
}

export interface PlayResult {
  /** Standard games: explicit win flag */
  win?: boolean;
  /** GlobalStar tournament: isWin flag */
  isWin?: boolean;
  /** Tournament: placement rank */
  placement?: number;
  /** Tournament: tier label */
  tier?: string;
  coinsEarned: number;
  xpEarned: number;
  newBalance: number;
  newXp: number;
  message: string;
}

export interface GsFigure {
  id: number;
  name: string;
  domain: string;
  domainLabel: string;
  nationality: string;
  imageUrl: string | null;
  votes: number;
  rank: number;
  bio: string;
}

export interface GsDomain {
  id: string;
  label: string;
  icon: string;
  figureCount: number;
  totalVotes: number;
}

export interface TransactionItem {
  id: number;
  amount: number;
  type: string;
  description: string;
  createdAt: string;
}
