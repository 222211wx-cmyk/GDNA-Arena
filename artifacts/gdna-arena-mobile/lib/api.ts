/**
 * Arena Qaisypro API client for React Native.
 * Handles cookie-based session auth by storing the session cookie in native
 * encrypted secure storage.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { assertNetworkOnline } from '@/contexts/OnlineContext';
import { uploadFraction } from './attachment-policy';

const SESSION_KEY = 'gdna.session.cookie';
const CACHED_USER_KEY = 'gdna.auth.user.v1';

export function getApiBase(): string {
  const configured = process.env.EXPO_PUBLIC_API_ORIGIN ?? process.env.EXPO_PUBLIC_DOMAIN;
  if (!configured) {
    if (__DEV__) return 'http://localhost:3000/api';
    throw new Error('API configuration is missing. Set EXPO_PUBLIC_API_ORIGIN or EXPO_PUBLIC_DOMAIN to a public HTTPS host.');
  }
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//iu.test(configured)
    ? configured
    : `https://${configured}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error('API configuration is invalid. Provide a valid HTTPS API origin or domain.');
  }
  const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (localHost && !__DEV__) {
    throw new Error('API configuration must use a public HTTPS host in release builds; localhost is not allowed.');
  }
  if (!localHost && url.protocol !== 'https:') {
    throw new Error('API configuration must use HTTPS outside local development.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('API configuration must be an origin without credentials, query, or fragment.');
  }
  const path = url.pathname.replace(/\/+$/u, '');
  if (process.env.EXPO_PUBLIC_API_ORIGIN) {
    return `${url.origin}${path === '/api' ? path : `${path}/api`}`;
  }
  if (path && path !== '/') throw new Error('EXPO_PUBLIC_DOMAIN must be a hostname without a path.');
  return `${url.origin}/api`;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function loadCachedAuthUser(): Promise<AuthUser | null> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(CACHED_USER_KEY);
    return null;
  }
  const stored = await SecureStore.getItemAsync(CACHED_USER_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<AuthUser>;
    if (
      typeof parsed.id !== 'number' ||
      typeof parsed.username !== 'string' ||
      typeof parsed.balance !== 'number' ||
      typeof parsed.xp !== 'number'
    ) {
      await SecureStore.deleteItemAsync(CACHED_USER_KEY);
      return null;
    }
    return parsed as AuthUser;
  } catch {
    await SecureStore.deleteItemAsync(CACHED_USER_KEY);
    return null;
  }
}

export async function saveCachedAuthUser(user: AuthUser): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(CACHED_USER_KEY);
    return;
  }
  await SecureStore.setItemAsync(CACHED_USER_KEY, JSON.stringify(user), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearCachedAuthUser(): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(CACHED_USER_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(CACHED_USER_KEY);
}

let sessionCookie: string | null = null;
let sessionGeneration = 0;
let sessionStorageQueue: Promise<void> = Promise.resolve();

const sessionStorage = {
  async get(): Promise<string | null> {
    if (Platform.OS === 'web') {
      // Browser sessions are carried only by same-origin HttpOnly cookies.
      // Remove credentials written by older Expo Web builds and never expose
      // them to script-readable storage again.
      if (typeof localStorage !== 'undefined') localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return SecureStore.getItemAsync(SESSION_KEY);
  },
  async set(value: string): Promise<void> {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(SESSION_KEY);
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
  if (sessionCookie && Platform.OS !== 'web') {
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
  assertNetworkOnline();
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
  assertNetworkOnline();
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'GET',
    headers: getHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.json();
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  assertNetworkOnline();
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

export async function apiUpload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  assertNetworkOnline();
  const headers = getHeaders();
  delete headers['Content-Type'];
  if (onProgress) {
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${getApiBase()}${path}`);
      xhr.withCredentials = true;
      Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
      xhr.upload.onprogress = event => {
        if (event.lengthComputable && event.total > 0) onProgress(uploadFraction(event.loaded, event.total));
      };
      xhr.onerror = () => reject(new Error('Encrypted attachment upload failed. Check your connection and retry.'));
      xhr.onabort = () => reject(new Error('Encrypted attachment upload cancelled.'));
      xhr.onload = () => {
        let body: { error?: string } & T;
        try { body = JSON.parse(xhr.responseText) as typeof body; }
        catch { reject(new Error(`Upload returned an invalid response (${xhr.status}).`)); return; }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new ApiError(xhr.status, body.error ?? `Upload failed (${xhr.status}).`));
        } else resolve(body);
      };
      xhr.send(form);
    });
  }
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'POST', headers, credentials: 'include', body: form,
  });
  return parseResponse<T>(res);
}

export function createAuthenticatedWebSocket(): WebSocket {
  assertNetworkOnline();
  const url = getApiBase().replace(/^http/, 'ws').replace(/\/api$/, '/api/ws');
  const options = sessionCookie && Platform.OS !== 'web' ? { headers: { Cookie: sessionCookie } } : undefined;
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
