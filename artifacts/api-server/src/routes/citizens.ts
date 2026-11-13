import { Router, type IRouter } from "express";
import { eq, desc, sql, ne, and } from "drizzle-orm";
import {
  db, usersTable, pulsePosts, legendDebatesTable, legendWatchesTable, userFollows,
} from "@workspace/db";
import { pool as _pool } from "@workspace/db";
import { pushNotification } from "./notifications";
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

// ── GET /citizens — discoverable citizen list / leaderboard ───────────────────
// Query params (all optional, all backwards-compatible):
//   limit  – max rows per page, 1-200, default 50
//   offset – zero-based page offset for pagination, default 0
//   sort   – "xp" (default) | "coins" | "honor"
//   search – case-insensitive username prefix / substring filter
//
// Exclusions (server-enforced, never client-controlled):
//   • is_star = TRUE  → hosted world stars are not citizen-discoverable
//   • password_hash = 'DELETED' → GDPR-erased accounts are not discoverable
router.get("/citizens", async (req, res): Promise<void> => {
  const viewerId = req.session?.userId ?? null;
  const limit  = Math.min(Math.max(parseInt(req.query.limit  as string) || 50,  1), 200);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
  const sort   = req.query.sort === "coins" ? "coins" : req.query.sort === "honor" ? "honor" : "xp";
  const searchValue = typeof req.query.search === "string"
    ? req.query.search
    : typeof req.query.q === "string"
      ? req.query.q
      : "";
  const search = searchValue.trim();

  // ORDER BY column is chosen from a safe allow-list — never interpolated from input.
  const orderClause =
    sort === "coins" ? `u.balance DESC`
    : sort === "honor" ? `u.honor_count DESC`
    : `u.xp DESC`;

  // Build the parameterised WHERE clause.
  // $1 is always the search pattern (ILIKE %…%), $2 = limit, $3 = offset.
  // Using a single query shape keeps the plan stable in pg's cache.
  const searchPattern = search.length > 0 ? `%${search}%` : "%";

  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.xp, u.balance, u.games_played, u.wins, u.created_at,
             u.honor_count, u.is_muted, u.last_seen_at, u.is_star,
             CASE WHEN sp.status_visible THEN sp.status ELSE NULL END AS "solidarityStatus"
     FROM "users" u
      LEFT JOIN citizen_solidarity_profiles sp ON sp.user_id = u.id
     WHERE COALESCE(u.is_star, FALSE) = FALSE
       AND u.password_hash <> 'DELETED'
       AND u.username ILIKE $1
        AND ($4::integer IS NULL OR NOT EXISTS (
          SELECT 1 FROM citizen_blocks cb WHERE (cb.blocker_id=$4 AND cb.blocked_id=u.id)
             OR (cb.blocker_id=u.id AND cb.blocked_id=$4)
        ))
     ORDER BY ${orderClause}, u.id ASC
     LIMIT $2 OFFSET $3`,
    [searchPattern, limit, offset, viewerId]
  );

  const citizens = rows.map((u: any, i: number) => ({
    ...u,
    xp: parseInt(u.xp ?? "0"),
    balance: parseInt(u.balance ?? "0"),
    honorCount: parseInt(u.honor_count ?? "0"),
    rank: getRank(parseInt(u.xp ?? "0")),
    honorInfo: getHonorTitle(parseInt(u.honor_count ?? "0")),
    // position reflects the global rank including offset so clients can display
    // continuous leaderboard numbers across pages
    position: offset + i + 1,
    lastSeenAt: u.last_seen_at ?? null,
  }));

  res.json({ citizens });
});

// ── GET /citizens/:username — full profile ────────────────────────────────────
router.get("/citizens/:username", async (req, res): Promise<void> => {
  const { username } = req.params;

  const { rows: userRows } = await pool.query(
    `SELECT id, username, xp, balance, games_played, wins, created_at, honor_count, is_muted, is_trending,
       EXISTS(SELECT 1 FROM royal_verifications rv WHERE rv.user_id="users".id AND rv.status='verified' AND rv.name_matches=TRUE) AS royal_verified
     FROM "users" WHERE username = $1 LIMIT 1`,
    [username]
  );
  if (!userRows[0]) { res.status(404).json({ error: "Citizen not found" }); return; }

  const user: any = userRows[0];
  user.xp = parseInt(user.xp ?? "0");
  user.balance = parseInt(user.balance ?? "0");
  user.honorCount = parseInt(user.honor_count ?? "0");
   user.royalVerified = user.royal_verified === true;

  if (!req.session?.userId) {
    const honorInfo = getHonorTitle(user.honorCount);
    res.json({
      publicOnly: true,
      citizen: {
        username: user.username,
        xp: user.xp,
        honorCount: user.honorCount,
        rank: getRank(user.xp),
        honorInfo,
         royalVerified: user.royalVerified,
      },
      recentPosts: [],
      achievements: [],
      violations: [],
      followers: [],
      following: [],
      earned: 0,
      total: 0,
    });
    return;
  }

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

  // Follower / following counts
  const { rows: followCountRows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM "user_follows" WHERE following_id = $1)::int AS followers,
       (SELECT COUNT(*) FROM "user_follows" WHERE follower_id  = $1)::int AS following`,
    [user.id]
  );
  const followerCount  = followCountRows[0]?.followers  ?? 0;
  const followingCount = followCountRows[0]?.following  ?? 0;

  // Follower list (latest 20)
  const { rows: followerRows } = await pool.query(
    `SELECT u.id, u.username, u.xp FROM "user_follows" uf
     JOIN "users" u ON u.id = uf.follower_id
     WHERE uf.following_id = $1 ORDER BY uf.created_at DESC LIMIT 20`,
    [user.id]
  );

  // Following list (latest 20)
  const { rows: followingRows } = await pool.query(
    `SELECT u.id, u.username, u.xp FROM "user_follows" uf
     JOIN "users" u ON u.id = uf.following_id
     WHERE uf.follower_id = $1 ORDER BY uf.created_at DESC LIMIT 20`,
    [user.id]
  );

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
      isTrending: user.is_trending ?? false,
      rank: getRank(user.xp),
      honorInfo: getHonorTitle(user.honorCount),
      specialty, totalDebates, uniqueLegends, totalWatches, recentHonors,
       followerCount, followingCount, royalVerified: user.royalVerified,
    },
    recentPosts,
    achievements,
    violations: violRows,
    followers: followerRows,
    following: followingRows,
    earned: achievements.filter(a => a.earned).length,
    total: achievements.length,
  });
});

// ── GET /citizens/:username/follow-status — is logged-in user following? ──────
router.get("/citizens/:username/follow-status", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.json({ isFollowing: false }); return; }
  const { username } = req.params;
  const { rows } = await pool.query(
    `SELECT 1 FROM "user_follows" uf
     JOIN "users" u ON u.id = uf.following_id
     WHERE uf.follower_id = $1 AND LOWER(u.username) = LOWER($2) LIMIT 1`,
    [userId, username]
  );
  res.json({ isFollowing: rows.length > 0 });
});

// ── POST /citizens/:username/follow — follow a citizen ────────────────────────
router.post("/citizens/:username/follow", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const { username } = req.params;

  const { rows } = await pool.query(
    `SELECT id FROM "users" WHERE LOWER(username) = LOWER($1) LIMIT 1`, [username]
  );
  if (!rows[0]) { res.status(404).json({ error: "Citizen not found" }); return; }
  const targetId: number = rows[0].id;

  if (targetId === userId) { res.status(400).json({ error: "Cannot follow yourself" }); return; }

  try {
    await db.insert(userFollows).values({ followerId: userId, followingId: targetId });
    const { rows: followerRows } = await pool.query(
      `SELECT username FROM "users" WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const followerUsername = followerRows[0]?.username;
    if (followerUsername) {
      await pushNotification({
        userId: targetId,
        type: "follow",
        title: "New follower",
        body: `${followerUsername} started following you`,
        icon: "👤",
        linkPath: `/citizen/${encodeURIComponent(followerUsername)}`,
      });
    }
    res.json({ isFollowing: true });
  } catch (err: any) {
    // Unique constraint violation = already following — treat as success
    if (err?.code === "23505") { res.json({ isFollowing: true, alreadyFollowing: true }); return; }
    req.log.error({ err }, "Failed to follow citizen");
    res.status(500).json({ error: "Failed to follow citizen" });
  }
});

// ── DELETE /citizens/:username/follow — unfollow a citizen ────────────────────
router.delete("/citizens/:username/follow", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const { username } = req.params;

  const { rows } = await pool.query(
    `SELECT id FROM "users" WHERE LOWER(username) = LOWER($1) LIMIT 1`, [username]
  );
  if (!rows[0]) { res.status(404).json({ error: "Citizen not found" }); return; }
  const targetId: number = rows[0].id;

  await db.delete(userFollows)
    .where(and(eq(userFollows.followerId, userId), eq(userFollows.followingId, targetId)));
  res.json({ isFollowing: false });
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
