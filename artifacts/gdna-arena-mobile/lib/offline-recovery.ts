/**
 * Offline account recovery (single-use recovery code). Independent of Firebase
 * and of any native module, so it works on iOS, Android and web.
 * Plaintext codes and passwords are never written to storage or the query cache:
 * the issue/redeem calls are invoked directly and results live in component state.
 */
import {
  generateRecoveryCode,
    redeemRecoveryCode,
  removeRecoveryCode,
  setBaseUrl,
} from '@workspace/api-client-react';
import { getApiBase, getHeaders } from '@/lib/api';
import { assertNetworkOnline } from '@/contexts/OnlineContext';

export function recoveryApiOptions(signal?: AbortSignal) {
  setBaseUrl(getApiBase().replace(/\/api$/, ''));
  return { headers: getHeaders(), credentials: 'include' as const, cache: 'no-store' as const, ...(signal ? { signal } : {}) };
}
const apiOptions = recoveryApiOptions;

export const CODE_MAX_LENGTH = 160;
export const PASSWORD_MIN_CHARS = 6;
export const PASSWORD_MAX_BYTES = 72;

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Mirrors the server policy: at least 6 characters, at most 72 UTF-8 bytes. */
export function passwordPolicyError(value: string): 'short' | 'long' | null {
  if (Array.from(value).length < PASSWORD_MIN_CHARS) return 'short';
  if (utf8ByteLength(value) > PASSWORD_MAX_BYTES) return 'long';
  return null;
}

export type RecoveryStatus = { active: boolean; expiresAt?: string | null };


export function issueRecoveryCode(currentPassword: string, signal?: AbortSignal): Promise<{ code: string; expiresAt: string }> {
  assertNetworkOnline();
  return generateRecoveryCode({ currentPassword }, apiOptions(signal)) as Promise<{ code: string; expiresAt: string }>;
}

export function revokeRecoveryCode(currentPassword: string, signal?: AbortSignal): Promise<RecoveryStatus> {
  assertNetworkOnline();
  return removeRecoveryCode({ currentPassword }, apiOptions(signal)) as Promise<RecoveryStatus>;
}

export function redeemCode(code: string, newPassword: string, signal?: AbortSignal): Promise<{ success: true; username: string; revocationPending: boolean }> {
  assertNetworkOnline();
  // No session cookie is persisted from this response: reset never logs in.
  return redeemRecoveryCode({ code: code.trim(), newPassword }, apiOptions(signal)) as Promise<{ success: true; username: string; revocationPending: boolean }>;
}

export type RecoveryErrorKind = 'offline' | 'credentials' | 'rate' | 'expired' | 'generic';

export function classifyRecoveryError(e: unknown): RecoveryErrorKind {
  if (e instanceof Error && e.name === 'AbortError') return 'generic';
  if (e instanceof Error && e.name === 'OfflineError') return 'offline';
  const status = (e as { status?: number } | null)?.status;
  if (status === 401 || status === 403) return 'credentials';
  if (status === 429) return 'rate';
  if (status === 400 || status === 404 || status === 410) return 'expired';
  if (e instanceof TypeError) return 'offline';
  return 'generic';
}
