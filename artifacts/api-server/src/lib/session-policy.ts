import type { Session, SessionData } from "express-session";

const DAY_MS = 24 * 60 * 60 * 1000;
// Browsers cap cookie lifetimes at 400 days. Sessions are rolling (renewed on
// every request), so a signed-in device stays signed in until the citizen logs
// out, changes credentials, or stays away longer than this window.
export const PERSISTENT_SESSION_TTL_MS = 400 * DAY_MS;
// Short sessions no longer exist: every session uses the persistent lifetime.
export const SHORT_SESSION_TTL_MS = PERSISTENT_SESSION_TTL_MS;

declare module "express-session" {
  interface SessionData {
    rememberMe?: boolean;
    // Server-only snapshot of the credentials that authorized this session.
    credentialEpoch?: number;
  }
}

type CitizenSession = Session & Partial<SessionData>;

/** Missing markers belong only to pre-fencing credentials (epoch zero). */
export function sessionCredentialEpoch(session: Partial<SessionData>): number {
  if (session.credentialEpoch === undefined) return 0;
  return Number.isSafeInteger(session.credentialEpoch) && session.credentialEpoch! >= 0
    ? session.credentialEpoch! : -1;
}

/** Every session persists. The rememberMe argument is accepted for callers but ignored. */
export function configureSessionLifetime(session: CitizenSession, _rememberMe = true): void {
  session.rememberMe = true;
  session.cookie.maxAge = PERSISTENT_SESSION_TTL_MS;
}

export function sessionLifetime(_session: CitizenSession): number {
  return PERSISTENT_SESSION_TTL_MS;
}
