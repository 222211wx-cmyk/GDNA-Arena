import type { RequestHandler } from "express";

/** Compatibility name: messaging requires authentication, not a subscription.
 * Route-level membership, blocking, moderation and rate limits remain in place.
 */
export const requireMessagingSubscription: RequestHandler = (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
};