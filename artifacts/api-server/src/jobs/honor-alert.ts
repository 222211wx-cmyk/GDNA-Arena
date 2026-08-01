// GDNA HONOR ALERT SYSTEM v1.0
// Detects trending citizens every 60s and sends empire honor notifications

import { pool } from "@workspace/db";

async function pushHonorNotification(userId: number, username: string) {
  await pool.query(
    `INSERT INTO notifications (user_id, type, title, body, icon, link_path)
     VALUES ($1, 'honor_alert', $2, $3, '👑', $4)`,
    [
      userId,
      `👑 تهانينا ${username} — وصلت للـ Trending!`,
      `مبروك يا ${username}، أنت الآن في قائمة الـ Trending ديال GDNA Arena. صفحتك الرسمية جاهزة. انت الإمبراطور ديال المحتوى ديالك 🏆`,
      `/citizen/${username}`,
    ]
  );
}

async function markTopUsersAsTrending() {
  // Top 10 active citizens by XP + honor become trending
  await pool.query(`
    UPDATE users
    SET is_trending = true
    WHERE id IN (
      SELECT id FROM users
      WHERE xp > 50
      ORDER BY (xp + honor_count * 10) DESC
      LIMIT 10
    )
  `);
}

async function checkTrendingAndSendHonor() {
  try {
    // First, refresh who is trending
    await markTopUsersAsTrending();

    // Find trending citizens who haven't received an honor alert yet
    const { rows } = await pool.query<{ id: number; username: string; xp: number; honor_count: number }>(`
      SELECT id, username, xp, honor_count
      FROM users
      WHERE is_trending = true
        AND honor_alert_sent = false
      ORDER BY (xp + honor_count * 10) DESC
      LIMIT 10
    `);

    for (const user of rows) {
      await pushHonorNotification(user.id, user.username);
      await pool.query(
        `UPDATE users SET honor_alert_sent = true WHERE id = $1`,
        [user.id]
      );
      console.log(`[HONOR] 👑 Alert dispatched → ${user.username} (XP: ${user.xp})`);
    }

    if (rows.length > 0) {
      console.log(`[HONOR] ${rows.length} citizen(s) honored this cycle`);
    }
  } catch (err) {
    console.warn("[HONOR] Alert job error:", err);
  }
}

export function startHonorAlertJob() {
  console.log("[HONOR] ⚡ GDNA Honor Alert System is LIVE — CORE SOCKET activated");

  // Initial run after 5 seconds (tables must be ready)
  setTimeout(checkTrendingAndSendHonor, 5_000);

  // Then every 60 seconds
  setInterval(checkTrendingAndSendHonor, 60_000);
}
