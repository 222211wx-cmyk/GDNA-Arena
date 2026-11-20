import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db, usersTable } from "@workspace/db";
import { configureSessionLifetime } from "./session-policy";
import { authorizeNewSession } from "./session-security";

/** Publishing needs no registration: a first publish silently opens an anonymous session. */
export async function ensureGuestSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.session?.userId) { next(); return; }
    const tag = randomBytes(8).toString("hex");
    const [user] = await db.insert(usersTable).values({
      username: `guest-${tag}`,
      email: `guest-${tag}@guest.invalid`,
      passwordHash: "!guest", // never a valid bcrypt hash: no password login
    }).returning();
    req.session.userId = user.id;
    authorizeNewSession(req.session, 0);
    configureSessionLifetime(req.session, true);
    await new Promise<void>((resolve, reject) => req.session.save(e => (e ? reject(e) : resolve())));
    next();
  } catch (error) { next(error); }
}
