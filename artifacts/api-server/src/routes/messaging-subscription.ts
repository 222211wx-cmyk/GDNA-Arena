import { Router } from "express";
import { pool } from "@workspace/db";
import { UpdateMessagingSubscriptionBody } from "@workspace/api-zod";
import { requireAdmin } from "../middleware/require-admin";
import { FREE_MESSAGE_LIMIT, getMessagingQuota } from "../lib/messaging-quota";

const router = Router();
router.get("/messages/subscription", async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!req.session?.userId) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const quota = await getMessagingQuota(req.session.userId);
    if (!quota) { res.status(401).json({ error: "Authentication required" }); return; }
    const hasActiveSubscription = quota.has_active_subscription === true;
    const freeMessagesRemaining = Math.max(0, FREE_MESSAGE_LIMIT - quota.free_messages_used);
    res.json({ hasActiveSubscription, canSendMessages: true, freeMessagesRemaining, messagingPolicy: "unlimited" });
  } catch (error) {
    req.log.error({ err: error }, "Messaging quota status failed");
    res.status(503).json({ error: "Unable to verify messaging subscription. Try again." });
  }
});

router.get("/admin/messaging-subscriptions", requireAdmin, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const { rows } = await pool.query(
    `SELECT id, username, has_active_subscription AS "hasActiveSubscription"
     FROM users WHERE password_hash <> 'DELETED' ORDER BY id`,
  );
  req.log.info({ actorId: req.session.userId }, "Administrator read messaging entitlements");
  res.json(rows);
});

router.patch("/admin/messaging-subscriptions/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const parsed = UpdateMessagingSubscriptionBody.strict().safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
    res.status(400).json({ error: "A valid citizen ID and boolean hasActiveSubscription are required" }); return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Re-check persisted admin privilege inside the same transaction as the grant.
    const actor = await client.query("SELECT is_admin FROM users WHERE id=$1 FOR SHARE", [req.session.userId]);
    if (actor.rows[0]?.is_admin !== true) {
      await client.query("ROLLBACK");
      res.status(403).json({ error: "Admin access required" }); return;
    }
    const citizen = await client.query("SELECT has_active_subscription FROM users WHERE id=$1 AND password_hash <> 'DELETED' FOR UPDATE", [id]);
    if (!citizen.rows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Citizen not found" }); return;
    }
    const active = parsed.data.hasActiveSubscription;
    await client.query("UPDATE users SET has_active_subscription=$2 WHERE id=$1", [id, active]);
    await client.query(
      "INSERT INTO messaging_subscription_audit(actor_id,citizen_id,previous_active,active) VALUES($1,$2,$3,$4)",
      [req.session.userId, id, citizen.rows[0].has_active_subscription, active],
    );
    await client.query("COMMIT");
    req.log.info({ actorId: req.session.userId, citizenId: id, active }, "Messaging subscription changed");
    res.json({ hasActiveSubscription: active });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ err: error }, "Messaging subscription update failed");
    res.status(503).json({ error: "Subscription was not updated. Try again." });
  } finally { client.release(); }
});
export default router;
