import type { RequestHandler } from "express";
import { senderExpectationMatches } from "./message-idempotency";

/** Runs before the send handler can perform any database work. Session alone authenticates. */
export const expectedSenderGuard: RequestHandler = (req, res, next) => {
  const userId = req.session?.userId;
  if (userId && !senderExpectationMatches(req.body?.expectedSenderId, userId)) {
    res.status(409).json({ error: "Signed-in account changed; queued sender does not match" });
    return;
  }
  next();
};
