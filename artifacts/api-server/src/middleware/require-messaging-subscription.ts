import type { RequestHandler } from "express";
import { pool } from "@workspace/db";
import { FREE_MESSAGE_LIMIT, MESSAGING_ACTIVATION_MESSAGE } from "../lib/messaging-quota";

/** Never use session/client entitlement claims: re-read on every send/upload. */
export const requireMessagingSubscription: RequestHandler = async (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const { rows } = await pool.query(
      "SELECT has_active_subscription, free_messages_used FROM users WHERE id=$1", [userId],
    );
    if (rows[0]?.has_active_subscription !== true && !(rows[0]?.free_messages_used < FREE_MESSAGE_LIMIT)) {
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