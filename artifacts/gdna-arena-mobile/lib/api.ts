/**
 * GDNA Arena API client for React Native.
 * Handles cookie-based session auth by storing the session cookie in AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_KEY = '@gdna_session_cookie';

export function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}/api`;
  // Fallback for local dev
  return 'http://localhost:3000/api';
}

let sessionCookie: string | null = null;

export async function loadSessionCookie(): Promise<void> {
  sessionCookie = await AsyncStorage.getItem(SESSION_KEY);
}

export async function saveSessionCookie(cookie: string): Promise<void> {
  sessionCookie = cookie;
  await AsyncStorage.setItem(SESSION_KEY, cookie);
}

export async function clearSessionCookie(): Promise<void> {
  sessionCookie = null;
  await AsyncStorage.removeItem(SESSION_KEY);
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
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'POST',
    headers: getHeaders(),
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Capture session cookie on auth endpoints
  const cookie = extractCookie(res);
  if (cookie && cookie.includes('connect.sid')) {
    await saveSessionCookie(cookie);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errBody?.error ?? res.statusText);
  }
  return res.json();
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
