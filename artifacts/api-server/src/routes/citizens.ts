import { Router, type IRouter } from "express";
import { eq, desc, sql, ne } from "drizzle-orm";
import {
  db, usersTable, pulsePosts, legendDebatesTable, legendWatchesTable,
} from "@workspace/db";
import { pool as _pool } from "@workspace/db";
const pool = _pool!;

const router: IRouter = Router();

// ── Rank util (XP-based) ─────────────────────────────────────────────────────
function getRank(xp: number) {
  if (xp <   200) return { label: "Recruit",           tier: 0, color: "#6b7280", icon: "🌱" };
  if (xp <   500) return { label: "Foot Soldier I",    tier: 1, color: "#92400e", icon: "🪖" };
  if (xp <  1000) return { label: "Foot Soldier II",   tier: 1, color: "#b45309", icon: "🪖" };
  if (xp <  2000) return { label: "Knight I",          tier: 2, color: "#9ca3af", icon: "⚔️" };
  if (xp <  3500) return { label: "Knight II",         tier: 2, color: "#d1d5db", icon: "⚔️" };
  if (xp <  5000) return { label: "Commander I",       tier: 3, color: "#C9A84C", icon: "🛡️" };
  if (xp <  7500) return { label: "Commander II",      tier: 3, color: "#f59e0b", icon: "🛡️" };
  if (xp < 12000) return { label: "Imperial Champion", tier: 4, color: "#00D4FF", icon: "👑" };
  if (xp < 20000) return { label: "Grand Marshal",     tier: 5, color: "#a78bfa", icon: "🏛️" };
  return                 { label: "EMPEROR",            tier: 6, color: "#22c55e", icon: "⚡" };
}

// ── Honor title (honor-points based) ────────────────────────────────────────
function getHonorTitle(honorCount: number): { title: string; color: string; badge: string } {
  if (honorCount >=  50) return { title: "IMPERIAL LEGEND",  color: "#FFD700", badge: "🏆" };
  if (honorCount >=  25) return { title: "DISTINGUISHED",    color: "#a78bfa", badge: "💎" };
  if (honorCount >=  10) return { title: "HONORABLE",        color: "#22d3ee", badge: "🎖️" };
  if (honorCount >=   5) return { title: "RESPECTED",        color: "#4ade80", badge: "✅" };
  if (honorCount >=   1) return { title: "TRUSTED",          color: "#86efac", badge: "🤝" };
  return                          { title: "NEW CITIZEN",     color: "#6b7280", badge: "🌱" };
}

// ── GET /citizens — leaderboard ───────────────────────────────────────────────
router.get("/citizens", async (req, res): Promise<void> => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
  const sort  = req.query.sort === "coins" ? "coins" : req.query.sort === "honor" ? "honor" : "xp";

  const orderClause =
    sort === "coins" ? `u.balance DESC`
    : sort === "honor" ? `u.honor_count DESC`
    : `u.xp DESC`;

  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.xp, u.balance, u.games_played, u.wins, u.created_at, u.honor_count, u.is_muted
     FROM "users" u ORDER BY ${orderClause} LIMIT $1`,
    [limit]
  );

  const citizens = rows.map((u: any, i: number) => ({
    ...u,
    xp: parseInt(u.xp ?? "0"),
    balance: parseInt(u.balance ?? "0"),
    honorCount: parseInt(u.honor_count ?? "0"),
    rank: getRank(parseInt(u.xp ?? "0")),
    honorInfo: getHonorTitle(parseInt(u.honor_count ?? "0")),
    position: i + 1,
  }));

  res.json({ citizens });
});

// ── GET /citizens/:username — full profile ────────────────────────────────────
router.get("/citizens/:username", async (req, res): Promise<void> => {
  const { username } = req.params;

  const { rows: userRows } = await pool.query(
    `SELECT id, username, xp, balance, games_played, wins, created_at, honor_count, is_muted
     FROM "users" WHERE username = $1 LIMIT 1`,
    [username]
  );
  if (!userRows[0]) { res.status(404).json({ error: "Citizen not found" }); return; }

  const user: any = userRows[0];
  user.xp = parseInt(user.xp ?? "0");
  user.balance = parseInt(user.balance ?? "0");
  user.honorCount = parseInt(user.honor_count ?? "0");

  // Recent posts (up to 5)
  const recentPosts = await db
    .select()
    .from(pulsePosts)
    .where(eq(pulsePosts.username, username))
    .orderBy(desc(pulsePosts.createdAt))
    .limit(5);

  // Debate count + legend IDs
  const debateRows = await db
    .select({ legendId: legendDebatesTable.legendId })
    .from(legendDebatesTable)
    .where(eq(legendDebatesTable.username, username));

  const totalDebates = debateRows.length;
  const uniqueLegends = new Set(debateRows.map(r => r.legendId)).size;

  // Watch count
  const { rows: watchRows } = await pool.query(
    `SELECT COUNT(*)::int as cnt FROM "legend_watches" WHERE user_id = $1`,
    [user.id]
  );
  const totalWatches = parseInt(watchRows[0]?.cnt ?? "0");

  // Domain specialty
  const domainCounts: Record<string, number> = {};
  for (const p of recentPosts) domainCounts[p.domain] = (domainCounts[p.domain] ?? 0) + 1;
  const specialty = Object.entries(domainCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "general";

  // Who honored this citizen (latest 5)
  const { rows: honorRows } = await pool.query(
    `SELECT u.username FROM "citizen_honor" ch
     JOIN "users" u ON u.id = ch.giver_id
     WHERE ch.receiver_id = $1 ORDER BY ch.created_at DESC LIMIT 5`,
    [user.id]
  );
  const recentHonors = honorRows.map((r: any) => r.username);

  // Violations
  const { rows: violRows } = await pool.query(
    `SELECT reason, severity FROM "citizen_violations" WHERE user_id = $1 ORDER BY created_at DESC LIMIT 3`,
    [user.id]
  );

  // Achievements
  const achievements = [
    { id: "first_battle", icon: "🎮", label: "First Battle",    earned: user.gamesPlayed >= 1 },
    { id: "victor",       icon: "🏆", label: "Victor",          earned: user.wins >= 1 },
    { id: "debater",      icon: "💬", label: "Debater",         earned: totalDebates >= 1 },
    { id: "five_debates", icon: "🔥", label: "Arena Master",    earned: totalDebates >= 5 },
    { id: "voice",        icon: "📢", label: "Empire Voice",    earned: recentPosts.length >= 1 },
    { id: "watcher",      icon: "👁️", label: "Watcher",         earned: totalWatches >= 1 },
    { id: "legend_hunt",  icon: "🌟", label: "Legend Hunter",   earned: uniqueLegends >= 3 },
    { id: "elite",        icon: "⚡", label: "Elite",           earned: user.xp >= 1000 },
    { id: "wealthy",      icon: "💰", label: "Wealthy",         earned: user.balance >= 500 },
    { id: "champion",     icon: "👑", label: "Imperial Crest",  earned: user.xp >= 7500 },
    { id: "honored",      icon: "🎖️", label: "Honored",         earned: user.honorCount >= 1 },
    { id: "distinguished",icon: "💎", label: "Distinguished",   earned: user.honorCount >= 10 },
  ];

  res.json({
    citizen: {
      id: user.id, username: user.username, xp: user.xp, balance: user.balance,
      gamesPlayed: user.games_played, wins: user.wins, createdAt: user.created_at,
      honorCount: user.honorCount, isMuted: user.is_muted,
      rank: getRank(user.xp),
      honorInfo: getHonorTitle(user.honorCount),
      specialty, totalDebates, uniqueLegends, totalWatches, recentHonors,
    },
    recentPosts,
    achievements,
    violations: violRows,
    earned: achievements.filter(a => a.earned).length,
    total: achievements.length,
  });
});

// ── POST /citizens/:username/honor — give honor ───────────────────────────────
router.post("/citizens/:username/honor", async (req, res): Promise<void> => {
  const { user } = req as any;
  if (!user) { res.status(401).json({ error: "Login required to give honor" }); return; }

  const { username } = req.params;
  if (username === user.username) { res.status(400).json({ error: "You cannot honor yourself" }); return; }

  const { rows: targetRows } = await pool.query(
    `SELECT id, honor_count FROM "users" WHERE username = $1 LIMIT 1`, [username]
  );
  if (!targetRows[0]) { res.status(404).json({ error: "Citizen not found" }); return; }

  const target: any = targetRows[0];

  try {
    await pool.query(
      `INSERT INTO "citizen_honor" (giver_id, receiver_id) VALUES ($1, $2)`,
      [user.id, target.id]
    );
  } catch {
    res.status(409).json({ error: "You have already honored this citizen" });
    return;
  }

  const newHonorCount = (parseInt(target.honor_count ?? "0")) + 1;
  const honorInfo = getHonorTitle(newHonorCount);

  await pool.query(
    `UPDATE "users" SET honor_count = $1, honor_title = $2 WHERE id = $3`,
    [newHonorCount, honorInfo.title, target.id]
  );

  res.json({ success: true, honorCount: newHonorCount, honorInfo });
});

// ── GET /honor/tiers — public rank/honor chart ────────────────────────────────
router.get("/honor/tiers", (_req, res): Promise<void> => {
  res.json({
    rankTiers: [
      { label: "Recruit",           icon: "🌱", xpMin: 0,     color: "#6b7280", desc: "Just joined the Empire" },
      { label: "Foot Soldier I",    icon: "🪖", xpMin: 200,   color: "#92400e", desc: "Beginning the journey" },
      { label: "Foot Soldier II",   icon: "🪖", xpMin: 500,   color: "#b45309", desc: "Proving ground" },
      { label: "Knight I",          icon: "⚔️", xpMin: 1000,  color: "#9ca3af", desc: "Trusted citizen" },
      { label: "Knight II",         icon: "⚔️", xpMin: 2000,  color: "#d1d5db", desc: "Respected member" },
      { label: "Commander I",       icon: "🛡️", xpMin: 3500,  color: "#C9A84C", desc: "Experienced leader" },
      { label: "Commander II",      icon: "🛡️", xpMin: 5000,  color: "#f59e0b", desc: "Senior commander" },
      { label: "Imperial Champion", icon: "👑", xpMin: 7500,  color: "#00D4FF", desc: "Elite of the Empire" },
      { label: "Grand Marshal",     icon: "🏛️", xpMin: 12000, color: "#a78bfa", desc: "Living legend" },
      { label: "EMPEROR",           icon: "⚡", xpMin: 20000, color: "#22c55e", desc: "Supreme sovereign" },
    ],
    honorTiers: [
      { title: "New Citizen",       badge: "🌱", min: 0,  color: "#6b7280", desc: "Welcome to the Empire" },
      { title: "Trusted",           badge: "🤝", min: 1,  color: "#86efac", desc: "Earned first honor" },
      { title: "Respected",         badge: "✅", min: 5,  color: "#4ade80", desc: "Known for quality" },
      { title: "Honorable",         badge: "🎖️", min: 10, color: "#22d3ee", desc: "Community pillar" },
      { title: "Distinguished",     badge: "💎", min: 25, color: "#a78bfa", desc: "Empire icon" },
      { title: "Imperial Legend",   badge: "🏆", min: 50, color: "#FFD700", desc: "Immortalized in the Empire" },
    ],
  });
  return Promise.resolve();
});

export default router;
