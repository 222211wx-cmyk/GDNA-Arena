import type { Session, SessionData } from "express-session";

const DAY_MS = 24 * 60 * 60 * 1000;
export const PERSISTENT_SESSION_TTL_MS = 30 * DAY_MS;
export const SHORT_SESSION_TTL_MS = 7 * DAY_MS;
const LEGACY_REMEMBERED_TTL_MS = 30 * DAY_MS;

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

/** Only an explicit opt-out selects the existing seven-day rolling policy. */
export function configureSessionLifetime(session: CitizenSession, rememberMe = true): void {
  session.rememberMe = rememberMe;
  session.cookie.maxAge = rememberMe ? PERSISTENT_SESSION_TTL_MS : SHORT_SESSION_TTL_MS;
}

export function sessionLifetime(session: CitizenSession): number {
  if (session.rememberMe === false) return SHORT_SESSION_TTL_MS;
  if (session.rememberMe === true) return PERSISTENT_SESSION_TTL_MS;

  // Older sessions have no preference marker. Thirty-day cookies were issued
  // only by remembered login, registration, or password change, so they can be
  // upgraded safely. Seven-day cookies include explicit opt-outs AND omitted
  // login preferences: preserve them rather than guessing the citizen's choice.
  const previousTtl = session.cookie.originalMaxAge;
  if (previousTtl === LEGACY_REMEMBERED_TTL_MS || previousTtl === PERSISTENT_SESSION_TTL_MS) {
    return PERSISTENT_SESSION_TTL_MS;
  }
  return previousTtl ?? SHORT_SESSION_TTL_MS;
}
