import type { RequestHandler } from "express";
import { FREE_MESSAGE_LIMIT, getMessagingQuota, MESSAGING_ACTIVATION_MESSAGE } from "../lib/messaging-quota";

/** Never use session/client entitlement claims: re-read on every send/upload. */
export const requireMessagingSubscription: RequestHandler = async (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const quota = await getMessagingQuota(userId);
    if (quota?.has_active_subscription !== true && !(quota && quota.free_messages_used < FREE_MESSAGE_LIMIT)) {
      res.status(403).json({
        code: "MESSAGING_SUBSCRIPTION_REQUIRED",
        error: MESSAGING_ACTIVATION_MESSAGE,
      });
      return;
    }
    next();
  } catch (error) {
    req.log.error({ err: error }, "Messaging entitlement check failed");
    res.status(503).json({ error: "Unable to verify messaging subscription. Try again." });
  }
};