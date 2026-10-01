import type { Session, SessionData } from "express-session";

const DAY_MS = 24 * 60 * 60 * 1000;
export const PERSISTENT_SESSION_TTL_MS = 365 * DAY_MS;
export const SHORT_SESSION_TTL_MS = 7 * DAY_MS;
const LEGACY_REMEMBERED_TTL_MS = 30 * DAY_MS;

declare module "express-session" {
  interface SessionData {
    rememberMe?: boolean;
  }
}

type CitizenSession = Session & Partial<SessionData>;

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