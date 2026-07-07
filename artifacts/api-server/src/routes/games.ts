import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, transactionsTable } from "@workspace/db";

const router: IRouter = Router();

const GAMES: Record<string, { name: string; minReward: number; maxReward: number; winChance: number }> = {
  "neon-racer":   { name: "Neon Racer",   minReward: 20,  maxReward: 80,  winChance: 0.6 },
  "crypto-clash": { name: "Crypto Clash", minReward: 30,  maxReward: 120, winChance: 0.5 },
  "arena-strike": { name: "Arena Strike", minReward: 50,  maxReward: 200, winChance: 0.45 },
};

router.post("/games/:gameId/play", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const raw = Array.isArray(req.params.gameId) ? req.params.gameId[0] : req.params.gameId;
  const game = GAMES[raw];
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  const win = Math.random() < game.winChance;
  const coinsEarned = win
    ? Math.floor(Math.random() * (game.maxReward - game.minReward + 1)) + game.minReward
    : Math.floor(game.minReward * 0.2);
  const xpEarned = win ? Math.floor(coinsEarned * 0.8) : 10;

  const [updated] = await db
    .update(usersTable)
    .set({
      balance: sql`${usersTable.balance} + ${coinsEarned}`,
      xp: sql`${usersTable.xp} + ${xpEarned}`,
      gamesPlayed: sql`${usersTable.gamesPlayed} + 1`,
      wins: win ? sql`${usersTable.wins} + 1` : usersTable.wins,
    })
    .where(eq(usersTable.id, userId))
    .returning({ balance: usersTable.balance, xp: usersTable.xp });

  await db.insert(transactionsTable).values({
    userId,
    amount: coinsEarned,
    type: win ? "win" : "participation",
    description: `${game.name} — ${win ? "Victory" : "Defeat"} (+${coinsEarned} coins)`,
  });

  const message = win
    ? `Victory! You crushed it in ${game.name}!`
    : `Tough match in ${game.name}. Keep going!`;

  req.log.info({ userId, game: raw, win, coinsEarned }, "Game played");
  res.json({
    win,
    coinsEarned,
    xpEarned,
    newBalance: updated.balance,
    newXp: updated.xp,
    message,
  });
});

export default router;
