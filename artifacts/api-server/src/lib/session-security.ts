import type { RequestHandler } from "express";
import type { SessionData, Store } from "express-session";
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import { sessionCredentialEpoch } from "./session-policy";

export class SessionRevokedError extends Error {
  readonly status = 401;
  constructor() { super("Not authenticated"); }
}

// A loaded session can only UPDATE its still-live SID. Only credential routes
// can authorize the first INSERT of a freshly regenerated session object.
const issuedSessions = new WeakSet<object>();
export function authorizeNewSession(session: Partial<SessionData>, credentialEpoch: number): void {
  if (!Number.isSafeInteger(credentialEpoch) || credentialEpoch < 0) throw new SessionRevokedError();
  session.credentialEpoch = credentialEpoch;
  issuedSessions.add(session);
}

/** Public to server helpers only; no epoch is returned to an HTTP client. */
export async function sessionIsLive(sid: string, userId: number, credentialEpoch?: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM user_sessions s JOIN users u ON u.id = $2::integer
     WHERE s.sid = $1 AND s.sess->>'userId' = $2::text AND s.expire > NOW()
       AND COALESCE(s.sess->>'credentialEpoch', '0') = u.credential_epoch::text
       AND ($3::integer IS NULL OR u.credential_epoch = $3::integer)`,
    [sid, userId, credentialEpoch ?? null],
  );
  return !!result.rowCount;
}

export interface SessionLockClient {
  query<T extends Record<string, any> = Record<string, any>>(
    text: string, values?: any[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

/** Call inside a transaction. E2EE callers take (47201,1) BEFORE this helper.
 * FOR SHARE (not KEY SHARE) conflicts with credential epoch updates, while the
 * SID share lock serializes logout/session rotation. Keep both until the write
 * commits, including external mirror writes. Never acquire E2EE locks afterward.
 */
export async function lockLiveSession(
  client: SessionLockClient, userId: number, sid: string, credentialEpoch?: number,
): Promise<{ credentialEpoch: number; expiresAt: Date }> {
  const user = await client.query<{ credential_epoch: number }>(
    "SELECT credential_epoch FROM users WHERE id = $1 FOR SHARE", [userId],
  );
  const epoch = user.rows[0]?.credential_epoch;
  if (epoch === undefined || (credentialEpoch !== undefined && epoch !== credentialEpoch)) {
    throw new SessionRevokedError();
  }
  const live = await client.query<{ expire: Date }>(
    `SELECT expire FROM user_sessions
     WHERE sid = $1 AND sess->>'userId' = $2::text AND expire > NOW()
       AND COALESCE(sess->>'credentialEpoch', '0') = $3::text FOR SHARE`,
    [sid, userId, epoch],
  );
  if (!live.rowCount) throw new SessionRevokedError();
  return { credentialEpoch: epoch, expiresAt: live.rows[0].expire };
}

export async function withLiveSession<T>(
  userId: number, sid: string,
  action: (client: PoolClient, binding: { credentialEpoch: number; expiresAt: Date }) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const binding = await lockLiveSession(client, userId, sid);
    const result = await action(client, binding);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

/** Install on the normal connect-pg-simple instance, retaining its pruning and
 * destroy behavior. Every authenticated write serializes with user epoch changes.
 * No table changes or deployment-local revocation cache are needed.
 */
export function fenceSessionStore<T extends Store>(store: T): T {
  const baseGet = store.get.bind(store);
  const anonymousSet = store.set.bind(store);
  const anonymousTouch = store.touch?.bind(store);
  store.get = (sid, callback) => {
    // Preserve connect-pg-simple's parser and lazy pruning timer, then fence
    // the loaded snapshot before Express accepts its identity.
    baseGet(sid, (error, sess) => {
      if (error || !sess?.userId) { callback(error, sess); return; }
      void sessionIsLive(sid, sess.userId, sessionCredentialEpoch(sess)).then(
        live => callback(null, live ? sess : null), failure => callback(failure),
      );
    });
  };
  const persist = async (sid: string, sess: SessionData, touch: boolean): Promise<void> => {
    // Consume the one-shot INSERT grant synchronously, before any awaits.
    // Two concurrent saves must not both retain an insertion capability.
    const mayInsert = !touch && issuedSessions.delete(sess);
    const epoch = sessionCredentialEpoch(sess);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const user = await client.query<{ credential_epoch: number }>(
        "SELECT credential_epoch FROM users WHERE id = $1 FOR SHARE", [sess.userId],
      );
      if (epoch < 0 || user.rows[0]?.credential_epoch !== epoch) throw new SessionRevokedError();
      const expires = sess.cookie.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + 86400_000);
      if (expires.getTime() <= Date.now()) throw new SessionRevokedError();
      let result;
      if (mayInsert) {
        result = await client.query(
          `INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2, $3)
           ON CONFLICT (sid) DO NOTHING RETURNING sid`,
          [sid, JSON.stringify(sess), expires],
        );
      } else {
        // UPDATE only: stale save/touch cannot revive deleted or expired SIDs,
        // even when no password rotation happened (ordinary logout).
        result = await client.query(
          touch
            ? `UPDATE user_sessions SET expire = $2
               WHERE sid = $1 AND sess->>'userId' = $3::text AND expire > NOW()
                 AND COALESCE(sess->>'credentialEpoch', '0') = $4::text RETURNING sid`
            : `UPDATE user_sessions SET sess = $2, expire = $3
               WHERE sid = $1 AND sess->>'userId' = $4::text AND expire > NOW()
                 AND COALESCE(sess->>'credentialEpoch', '0') = $5::text RETURNING sid`,
          touch ? [sid, expires, sess.userId, epoch]
            : [sid, JSON.stringify(sess), expires, sess.userId, epoch],
        );
      }
      if (!result.rowCount) throw new SessionRevokedError();
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  };
  store.set = (sid, sess, callback) => {
    if (!sess.userId) { anonymousSet(sid, sess, callback); return; }
    void persist(sid, sess, false).then(() => callback?.(), error => callback?.(error));
  };
  store.touch = (sid, sess, callback?: (error?: unknown) => void) => {
    if (!sess.userId) { anonymousTouch?.(sid, sess, callback); return; }
    void persist(sid, sess, true).then(() => callback?.(), error => callback?.(error));
  };
  return store;
}

/** Recheck loaded identities at dispatch, using canonical PG state on all replicas. */
export const requireLiveSession: RequestHandler = async (req, res, next) => {
  if (!req.session?.userId) { next(); return; }
  try {
    if (await sessionIsLive(req.sessionID, req.session.userId, sessionCredentialEpoch(req.session))) {
      next(); return;
    }
    // Do not destroy a potentially newer store row on a stale request. Prevent
    // express-session from trying to save this stale identity on response end.
    req.session = null as unknown as typeof req.session;
    res.clearCookie("connect.sid", {
      path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    });
    res.status(401).json({ error: "Not authenticated" });
  } catch (error) {
    req.log.error(error, "Live session check unavailable");
    res.status(503).json({ error: "Session temporarily unavailable — please retry" });
  }
};
