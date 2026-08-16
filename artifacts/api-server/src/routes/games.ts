import { Router, type IRouter } from "express";
import { eq, sql, desc } from "drizzle-orm";
import { db, usersTable, transactionsTable } from "@workspace/db";
import { pushNotification } from "./notifications";

const router: IRouter = Router();

// ── Standard 3 games ──────────────────────────────────────────────────────────
const GAMES: Record<string, { name: string; minReward: number; maxReward: number; winChance: number }> = {
  "neon-racer":   { name: "Neon Racer",   minReward: 20,  maxReward: 80,  winChance: 0.6  },
  "crypto-clash": { name: "Crypto Clash", minReward: 30,  maxReward: 120, winChance: 0.5  },
  "arena-strike": { name: "Arena Strike", minReward: 50,  maxReward: 200, winChance: 0.45 },
};

// ── Standard play: 3 games ─────────────────────────────────────────────────────
router.post("/games/:gameId/play", async (req, res): Promise<void> => {
  const userId = req.session?.userId ?? null;
  const raw = Array.isArray(req.params.gameId) ? req.params.gameId[0] : req.params.gameId;

  if (raw === "globalstar") { res.status(404).json({ error: "Use /api/games/globalstar/tournament" }); return; }

  const game = GAMES[raw];
  if (!game) { res.status(404).json({ error: "Unknown game" }); return; }

  // Outcome is always server-determined — never trust req.body.win
  const win = Math.random() < game.winChance;

  // Server-authoritative reward: win → random in [min, max]; loss → 10% of min
  const coinsEarned: number = win
    ? Math.floor(game.minReward + Math.random() * (game.maxReward - game.minReward))
    : Math.floor(game.minReward * 0.1);
  const xpEarned = Math.round(coinsEarned * 1.2);

  let newBalance = coinsEarned;
  let newXp = xpEarned;

  // Only persist if user is logged in
  if (userId) {
    const [updated] = await db
      .update(usersTable)
      .set({
        balance:     sql`${usersTable.balance} + ${coinsEarned}`,
        xp:          sql`${usersTable.xp} + ${xpEarned}`,
        gamesPlayed: sql`${usersTable.gamesPlayed} + 1`,
        wins:        win ? sql`${usersTable.wins} + 1` : usersTable.wins,
      })
      .where(eq(usersTable.id, userId))
      .returning({ balance: usersTable.balance, xp: usersTable.xp, username: usersTable.username });

    await db.insert(transactionsTable).values({
      userId,
      amount: coinsEarned,
      type: win ? "win" : "participation",
      description: `${game.name} — ${win ? "Victory" : "Defeat"} (+${coinsEarned} coins)`,
    });

    newBalance = updated.balance;
    newXp = updated.xp;
    req.log.info({ userId, game: raw, win, coinsEarned }, "Game played");
    void pushNotification({
      userId,
      type: win ? "coins_earned" : "xp_earned",
      title: win ? `🎮 Victory in ${game.name}!` : `🎮 ${game.name} — Keep Going!`,
      body: win
        ? `+${coinsEarned} Coins & +${xpEarned} XP earned for your win.`
        : `+${xpEarned} XP earned for participating. Every match counts.`,
      icon: win ? "🏆" : "🎮",
      linkPath: "/games",
    });
  }

  res.json({
    win, coinsEarned, xpEarned, newBalance, newXp,
    message: win ? `Victory! You crushed it in ${game.name}!` : `Tough match in ${game.name}. Keep going!`,
  });
});

// ── GlobalStar Tournament: غربل غربل ─────────────────────────────────────────
router.post("/games/globalstar/tournament", async (req, res): Promise<void> => {
  const userId = req.session?.userId ?? null;

  // Weighted placement: ~12% top-10, 88% finish 11-100
  let placement: number;
  const roll = Math.random();
  if (roll < 0.01)        placement = 1;
  else if (roll < 0.04)   placement = Math.random() < 0.5 ? 2 : 3;
  else if (roll < 0.12)   placement = Math.floor(Math.random() * 7) + 4;
  else                    placement = Math.floor(Math.random() * 90) + 11;

  let coinsEarned: number;
  let tier: "champion" | "elite" | "legend" | "citizen";
  if      (placement === 1)  { coinsEarned = 200; tier = "champion"; }
  else if (placement <= 3)   { coinsEarned = 100; tier = "elite";    }
  else if (placement <= 10)  { coinsEarned = 50;  tier = "legend";   }
  else                       { coinsEarned = 10;  tier = "citizen";  }

  const xpEarned = Math.round(coinsEarned * 1.2);
  const isWin    = placement <= 10;

  let newBalance = coinsEarned;
  let newXp = xpEarned;
  let username = "CITIZEN";

  // Only persist if user is logged in
  if (userId) {
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

    newBalance = updated.balance;
    newXp = updated.xp;
    username = updated.username;
    req.log.info({ userId, placement, coinsEarned, tier }, "GlobalStar tournament played");

    const tierEmoji = tier === "champion" ? "🥇" : tier === "elite" ? "🥈" : tier === "legend" ? "🥉" : "⭐";
    void pushNotification({
      userId,
      type: "coins_earned",
      title: `${tierEmoji} Tournament — Rank #${placement}`,
      body: `+${coinsEarned} Coins & +${xpEarned} XP earned in the GlobalStar Tournament.`,
      icon: tierEmoji,
      linkPath: "/games/globalstar/ranking",
    });
  }

  // Pull top 10 leaderboard for display
  const top10 = await db
    .select({ id: usersTable.id, username: usersTable.username, xp: usersTable.xp })
    .from(usersTable)
    .orderBy(desc(usersTable.xp))
    .limit(10);

  res.json({
    placement, coinsEarned, xpEarned, tier, isWin,
    newBalance, newXp, username, top10,
    message: placement === 1  ? "CHAMPION OF THE EMPIRE! Supreme victory!"
           : placement <= 3   ? "ELITE CITIZEN — You stand among the few!"
           : placement <= 10  ? "LEGEND — The empire recognizes your tribute!"
           : `Rank #${placement} — Compete again to claim your legend.`,
  });
});

export default router;
