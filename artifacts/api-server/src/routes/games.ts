import { Router, type IRouter } from "express";
import { eq, sql, desc } from "drizzle-orm";
import { db, usersTable, transactionsTable } from "@workspace/db";

const router: IRouter = Router();

// ── Standard 3 games ──────────────────────────────────────────────────────────
const GAMES: Record<string, { name: string; minReward: number; maxReward: number; winChance: number }> = {
  "neon-racer":   { name: "Neon Racer",   minReward: 20,  maxReward: 80,  winChance: 0.6  },
  "crypto-clash": { name: "Crypto Clash", minReward: 30,  maxReward: 120, winChance: 0.5  },
  "arena-strike": { name: "Arena Strike", minReward: 50,  maxReward: 200, winChance: 0.45 },
};

// ── Standard play: 3 games ─────────────────────────────────────────────────────
router.post("/games/:gameId/play", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const raw = Array.isArray(req.params.gameId) ? req.params.gameId[0] : req.params.gameId;

  // Route GlobalStar to its own handler
  if (raw === "globalstar") { res.status(404).json({ error: "Use /api/games/globalstar/tournament" }); return; }

  const game = GAMES[raw];
  if (!game) { res.status(404).json({ error: "Game not found" }); return; }

  const win = Math.random() < game.winChance;
  const coinsEarned = win
    ? Math.floor(Math.random() * (game.maxReward - game.minReward + 1)) + game.minReward
    : Math.floor(game.minReward * 0.2);
  const xpEarned = win ? Math.floor(coinsEarned * 0.8) : 10;

  const [updated] = await db
    .update(usersTable)
    .set({
      balance:     sql`${usersTable.balance} + ${coinsEarned}`,
      xp:          sql`${usersTable.xp} + ${xpEarned}`,
      gamesPlayed: sql`${usersTable.gamesPlayed} + 1`,
      wins:        win ? sql`${usersTable.wins} + 1` : usersTable.wins,
    })
    .where(eq(usersTable.id, userId))
    .returning({ balance: usersTable.balance, xp: usersTable.xp });

  await db.insert(transactionsTable).values({
    userId,
    amount: coinsEarned,
    type: win ? "win" : "participation",
    description: `${game.name} — ${win ? "Victory" : "Defeat"} (+${coinsEarned} coins)`,
  });

  req.log.info({ userId, game: raw, win, coinsEarned }, "Game played");
  res.json({ win, coinsEarned, xpEarned, newBalance: updated.balance, newXp: updated.xp,
    message: win ? `Victory! You crushed it in ${game.name}!` : `Tough match in ${game.name}. Keep going!` });
});

// ── GlobalStar Tournament: غربل غربل ─────────────────────────────────────────
// POST /api/games/globalstar/tournament
// Simulates a 100-player tournament. Returns placement + coins awarded.
router.post("/games/globalstar/tournament", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  // Weighted placement: ~12% top-10, 88% finish 11-100
  let placement: number;
  const roll = Math.random();
  if (roll < 0.01)        placement = 1;                                           // 1%  → 1st
  else if (roll < 0.04)   placement = Math.random() < 0.5 ? 2 : 3;               // 3%  → 2nd-3rd
  else if (roll < 0.12)   placement = Math.floor(Math.random() * 7) + 4;          // 8%  → 4th-10th
  else                    placement = Math.floor(Math.random() * 90) + 11;         // 88% → 11-100

  // Coin rewards per rules
  let coinsEarned: number;
  let tier: "champion" | "elite" | "legend" | "citizen";
  if      (placement === 1)             { coinsEarned = 200; tier = "champion"; }
  else if (placement <= 3)              { coinsEarned = 100; tier = "elite";    }
  else if (placement <= 10)             { coinsEarned = 50;  tier = "legend";   }
  else                                  { coinsEarned = 10;  tier = "citizen";  }

  const xpEarned = Math.round(coinsEarned * 1.2);
  const isWin    = placement <= 10;

  const [updated] = await db
    .update(usersTable)
    .set({
      balance:     sql`${usersTable.balance} + ${coinsEarned}`,
      xp:          sql`${usersTable.xp} + ${xpEarned}`,
      gamesPlayed: sql`${usersTable.gamesPlayed} + 1`,
      wins:        isWin ? sql`${usersTable.wins} + 1` : usersTable.wins,
    })
    .where(eq(usersTable.id, userId))
    .returning({ balance: usersTable.balance, xp: usersTable.xp, username: usersTable.username });

  await db.insert(transactionsTable).values({
    userId,
    amount: coinsEarned,
    type: isWin ? "win" : "participation",
    description: `GlobalStar Tournament — Rank #${placement} (+${coinsEarned} coins)`,
  });

  // Pull top 10 leaderboard for display
  const top10 = await db
    .select({ id: usersTable.id, username: usersTable.username, xp: usersTable.xp })
    .from(usersTable)
    .orderBy(desc(usersTable.xp))
    .limit(10);

  req.log.info({ userId, placement, coinsEarned, tier }, "GlobalStar tournament played");
  res.json({ placement, coinsEarned, xpEarned, tier, isWin,
    newBalance: updated.balance, newXp: updated.xp, username: updated.username,
    top10,
    message: placement === 1  ? "CHAMPION OF THE EMPIRE! Supreme victory!"
           : placement <= 3   ? "ELITE CITIZEN — You stand among the few!"
           : placement <= 10  ? "LEGEND — The empire recognizes your tribute!"
           : `Rank #${placement} — Compete again to claim your legend.` });
});

export default router;
