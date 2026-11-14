import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { eq, sql, desc } from "drizzle-orm";
import {
  db,
  gsMatchesTable,
  gsPlayersTable,
  transactionsTable,
  usersTable,
} from "../lib/db";
import { pushNotification } from "./notifications";
import { isAdultForGames } from "../lib/age";

const router: IRouter = Router();

type PenaltyDirection = "left" | "center" | "right";
type PenaltyShot = {
  number: number;
  direction: PenaltyDirection;
  keeperDirection: PenaltyDirection;
  goal: boolean;
};
type PenaltyMatch = {
  id: string;
  shots: PenaltyShot[];
  completed: boolean;
  settled: boolean;
};

type SessionWithPenaltyMatch = Request["session"] & {
  penaltyKingMatch?: PenaltyMatch;
};

const PENALTY_DIRECTIONS: PenaltyDirection[] = ["left", "center", "right"];

function isPenaltyDirection(value: unknown): value is PenaltyDirection {
  return typeof value === "string" && PENALTY_DIRECTIONS.includes(value as PenaltyDirection);
}

function penaltyResponse(match: PenaltyMatch, xpEarned = 0) {
  const goals = match.shots.filter((shot) => shot.goal).length;
  const win = match.completed && goals >= 3;
  return {
    matchId: match.id,
    shots: match.shots,
    shotNumber: match.shots.length,
    totalShots: 5,
    goals,
    saves: match.shots.length - goals,
    complete: match.completed,
    win,
    xpEarned,
  };
}

async function requireAdultPlayer(req: Request, res: Response): Promise<number | null> {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({
      code: "GAMES_LOGIN_REQUIRED",
      error: "هذا القسم يتطلب +18 حسب قوانين بلدك. سجّل الدخول أولاً.",
    });
    return null;
  }

  const [user] = await db
    .select({ birthDate: usersTable.birthDate })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(401).json({ code: "GAMES_LOGIN_REQUIRED", error: "الحساب غير موجود" });
    return null;
  }

  const isAdult = isAdultForGames(user.birthDate);
  if (isAdult === null) {
    res.status(428).json({
      code: "GAMES_BIRTH_DATE_REQUIRED",
      error: "هذا القسم يتطلب +18 حسب قوانين بلدك. سجّل تاريخ ميلادك أولاً.",
    });
    return null;
  }
  if (!isAdult) {
    res.status(403).json({
      code: "GAMES_18_PLUS",
      error: "هذا القسم يتطلب +18 حسب قوانين بلدك",
    });
    return null;
  }

  return userId;
}

function requireAuthenticatedPlayer(req: Request, res: Response): number | null {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({
      code: "GAME_LOGIN_REQUIRED",
      error: "سجّل الدخول لحفظ XP ونتيجة اللعب.",
    });
    return null;
  }
  return userId;
}

// ── Standard 3 games ──────────────────────────────────────────────────────────
const GAMES: Record<string, { name: string; minReward: number; maxReward: number; winChance: number; xpOnly?: boolean }> = {
  "neon-racer":   { name: "Neon Racer",   minReward: 20,  maxReward: 80,  winChance: 0.6  },
  "crypto-clash": { name: "Crypto Clash", minReward: 30,  maxReward: 120, winChance: 0.5  },
  "arena-strike": { name: "Arena Strike", minReward: 50,  maxReward: 200, winChance: 0.45 },
  "penalty-king": { name: "ضربات الجزاء الملكية", minReward: 5, maxReward: 50, winChance: 0.55, xpOnly: true },
};

// ── Standard play: 3 games ─────────────────────────────────────────────────────
router.post("/games/:gameId/play", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.gameId) ? req.params.gameId[0] : req.params.gameId;

  if (raw === "globalstar") { res.status(404).json({ error: "Use /api/games/globalstar/tournament" }); return; }

  const game = GAMES[raw];
  if (!game) { res.status(404).json({ error: "Unknown game" }); return; }

  // XP-only games are open to every registered age. Coins/crypto games remain 18+.
  const userId = game.xpOnly
    ? requireAuthenticatedPlayer(req, res)
    : await requireAdultPlayer(req, res);
  if (!userId) return;

  if (raw === "penalty-king") {
    const direction = req.body?.direction;
    if (!isPenaltyDirection(direction)) {
      res.status(400).json({
        code: "PENALTY_DIRECTION_REQUIRED",
        error: "اختر جهة صحيحة للتسديدة: يسار أو وسط أو يمين.",
      });
      return;
    }

    const session = req.session as SessionWithPenaltyMatch;
    let match = session.penaltyKingMatch;
    if (!match || (match.completed && req.body?.restart === true)) {
      match = {
        id: `pk_${randomUUID().replace(/-/g, "")}`,
        shots: [],
        completed: false,
        settled: false,
      };
      session.penaltyKingMatch = match;
    }

    if (match.completed) {
      res.status(409).json({
        code: "PENALTY_MATCH_COMPLETE",
        error: "انتهت المباراة. ابدأ مباراة جديدة للعب مرة أخرى.",
        ...penaltyResponse(match),
      });
      return;
    }

    const keeperDirection = PENALTY_DIRECTIONS[Math.floor(Math.random() * PENALTY_DIRECTIONS.length)];
    const goal = direction !== keeperDirection;
    match.shots.push({
      number: match.shots.length + 1,
      direction,
      keeperDirection,
      goal,
    });
    match.completed = match.shots.length === 5;

    let xpEarned = 0;
    if (match.completed && !match.settled) {
      const goals = match.shots.filter((shot) => shot.goal).length;
      const win = goals >= 3;
      xpEarned = 5 + goals * 5 + (win ? 20 : 0);

      const [updated] = await db
        .update(usersTable)
        .set({
          xp: sql`${usersTable.xp} + ${xpEarned}`,
          gamesPlayed: sql`${usersTable.gamesPlayed} + 1`,
          wins: win ? sql`${usersTable.wins} + 1` : usersTable.wins,
        })
        .where(eq(usersTable.id, userId))
        .returning({ xp: usersTable.xp });

      if (!updated) {
        res.status(404).json({ error: "الحساب غير موجود" });
        return;
      }

      await db.insert(transactionsTable).values({
        userId,
        amount: 0,
        type: win ? "win" : "participation",
        description: `${game.name} — ${goals}/5 goals (+${xpEarned} XP)`,
      });
      match.settled = true;

      void pushNotification({
        userId,
        type: "xp_earned",
        title: win ? "👑 فوز في دوري الملوك!" : "⚽ اكتملت مباراة دوري الملوك",
        body: `${goals}/5 أهداف — +${xpEarned} XP`,
        icon: win ? "🏆" : "⚽",
        linkPath: "/games/penalty-king",
      });
    }

    req.log.info(
      { userId, matchId: match.id, shot: match.shots.length, direction, keeperDirection, goal },
      "Penalty King shot played",
    );
    res.json({
      ...penaltyResponse(match, xpEarned),
      keeperDirection,
      goal,
      message: goal ? "GOAL" : "SAVED",
    });
    return;
  }

  // Outcome is always server-determined — never trust req.body.win
  const win = Math.random() < game.winChance;

  // Server-authoritative reward: win → random in [min, max]; loss → 10% of min
  const baseReward: number = win
    ? Math.floor(game.minReward + Math.random() * (game.maxReward - game.minReward))
    : Math.floor(game.minReward * 0.1);
  const coinsEarned = game.xpOnly ? 0 : baseReward;
  const xpEarned = game.xpOnly ? Math.max(1, baseReward) : Math.round(baseReward * 1.2);

  let newBalance = coinsEarned;
  let newXp = xpEarned;

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
      description: game.xpOnly
        ? `${game.name} — ${win ? "Victory" : "Defeat"} (+${xpEarned} XP)`
        : `${game.name} — ${win ? "Victory" : "Defeat"} (+${coinsEarned} coins)`,
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

  res.json({
    win, coinsEarned, xpEarned, newBalance, newXp,
    message: win ? `Victory! You crushed it in ${game.name}!` : `Tough match in ${game.name}. Keep going!`,
  });
});

// ── GlobalStar Tournament: غربل غربل ─────────────────────────────────────────
router.post("/games/globalstar/tournament", async (req, res): Promise<void> => {
  const userId = await requireAdultPlayer(req, res);
  if (!userId) return;

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

  const updated = await db.transaction(async (tx) => {
    const [citizen] = await tx
        .update(usersTable)
        .set({
          balance:     sql`${usersTable.balance} + ${coinsEarned}`,
          xp:          sql`${usersTable.xp} + ${xpEarned}`,
          gamesPlayed: sql`${usersTable.gamesPlayed} + 1`,
          wins:        isWin ? sql`${usersTable.wins} + 1` : usersTable.wins,
        })
        .where(eq(usersTable.id, userId))
        .returning({ balance: usersTable.balance, xp: usersTable.xp, username: usersTable.username });

    await tx.insert(transactionsTable).values({
        userId,
        amount: coinsEarned,
        type: isWin ? "win" : "participation",
        description: `GlobalStar Tournament — Rank #${placement} (+${coinsEarned} coins)`,
      });

    const [match] = await tx.insert(gsMatchesTable).values({
      userId,
      placement,
      coinsEarned,
      xpEarned,
      tier,
      isWin,
    }).returning({ id: gsMatchesTable.id });

    await tx.insert(gsPlayersTable).values({
      matchId: match.id,
      userId,
      username: citizen.username,
      isUser: true,
      score: coinsEarned,
      placement,
    });

    return citizen;
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
