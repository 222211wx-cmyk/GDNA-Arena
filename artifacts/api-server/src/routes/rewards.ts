import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, transactionsTable } from "../lib/db";

const router: IRouter = Router();

const DAILY_REWARD = 100;

function isNewDay(last: Date | null): boolean {
  if (!last) return true;
  const now = new Date();
  const lastDate = new Date(last);
  return (
    now.getUTCFullYear() !== lastDate.getUTCFullYear() ||
    now.getUTCMonth() !== lastDate.getUTCMonth() ||
    now.getUTCDate() !== lastDate.getUTCDate()
  );
}

router.post("/rewards/daily", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [user] = await db
    .select({ lastDailyReward: usersTable.lastDailyReward })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  if (!isNewDay(user.lastDailyReward)) {
    res.status(400).json({ error: "Already claimed today. Come back tomorrow!" });
    return;
  }

  // Atomic guard: the WHERE clause re-checks "new day" inside the UPDATE, so
  // two simultaneous requests can never both pay out (race-proof).
  const [updated] = await db
    .update(usersTable)
    .set({
      balance: sql`${usersTable.balance} + ${DAILY_REWARD}`,
      lastDailyReward: new Date(),
    })
    .where(sql`${usersTable.id} = ${userId} AND (${usersTable.lastDailyReward} IS NULL OR (${usersTable.lastDailyReward} AT TIME ZONE 'UTC')::date < (NOW() AT TIME ZONE 'UTC')::date)`)
    .returning({ balance: usersTable.balance });

  if (!updated) {
    res.status(400).json({ error: "Already claimed today. Come back tomorrow!" });
    return;
  }

  await db.insert(transactionsTable).values({
    userId,
    amount: DAILY_REWARD,
    type: "daily_reward",
    description: "Daily Login Reward",
  });

  req.log.info({ userId }, "Daily reward claimed");
  res.json({
    coinsEarned: DAILY_REWARD,
    newBalance: updated.balance,
    message: "Daily reward claimed! +100 coins",
  });
});

export default router;
