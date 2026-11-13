import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/leaderboard", async (_req, res): Promise<void> => {
  const players = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      balance: usersTable.balance,
      wins: usersTable.wins,
      gamesPlayed: usersTable.gamesPlayed,
      xp: usersTable.xp,
    })
    .from(usersTable)
    .orderBy(desc(usersTable.balance))
    .limit(20);

  res.json({ players });
});

export default router;
