// ══════════════════════════════════════════════════════════════════════════════
//  EVENT-LIVE ALERT JOB
//  Runs every 60s. Finds pulse_events / legend_arena_events that became
//  is_live=true but haven't been fully notified yet. Fans out to all citizens.
//
//  Reliability guarantees:
//  - source_ref = "<table>:<id>" is stored on each notification row.
//  - A partial unique index on (user_id, source_ref) prevents duplicates,
//    so ON CONFLICT DO NOTHING makes each delivery idempotent.
//  - notified_live is set TRUE only AFTER the bulk INSERT succeeds.
//  - If the process crashes mid-fan-out, next run retries; duplicates are
//    blocked by the unique index, so already-notified users are skipped.
//  - Uses keyset pagination (WHERE u.id > last_id) so the shrinking
//    eligible-user set never causes OFFSET to skip rows.
// ══════════════════════════════════════════════════════════════════════════════

import { pool } from "../lib/db";
import { broadcastToUser } from "../lib/signaling";

const BATCH_SIZE = 200;

async function fanOutEventLive(
  eventId: number,
  title: string,
  icon: string,
  linkPath: string,
  table: "pulse_events" | "legend_arena_events",
): Promise<void> {
  if (!pool) return;

  const sourceRef = `${table}:${eventId}`;
  const notifTitle = `🔴 LIVE NOW: ${title}`;
  const notifBody  = `${icon} This event just went live in the empire. Join now!`;

  let lastId = 0;
  let total  = 0;
  let failed = 0;

  while (true) {
    // Keyset pagination: always fetches the first BATCH_SIZE users with id > lastId
    // that haven't yet been notified for this specific source_ref.
    const { rows: users } = await pool.query<{ id: number }>(
      `SELECT u.id
       FROM users u
       WHERE u.id > $1
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.user_id   = u.id
             AND n.source_ref = $2
         )
       ORDER BY u.id
       LIMIT $3`,
      [lastId, sourceRef, BATCH_SIZE],
    );

    if (users.length === 0) break;

    // Bulk INSERT for this batch using ON CONFLICT DO NOTHING (idempotent).
    // Build the VALUES list.
    const values: unknown[] = [];
    const placeholders = users.map((u, i) => {
      const base = i * 7;
      values.push(u.id, "event_live", notifTitle, notifBody, "🔴", linkPath, sourceRef);
      return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7})`;
    });

    let insertedCount = 0;
    try {
      const { rowCount } = await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, icon, link_path, source_ref)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (user_id, source_ref) WHERE source_ref IS NOT NULL DO NOTHING`,
        values,
      );
      insertedCount = rowCount ?? 0;

      // Real-time push to any connected WS clients in this batch
      for (const u of users) {
        broadcastToUser(u.id, {
          type: "notification",
          notification: { type: "event_live", title: notifTitle, body: notifBody, icon: "🔴", linkPath, isRead: false, createdAt: new Date().toISOString() },
        });
      }
    } catch (err) {
      console.warn(`[EVENT-LIVE] Batch insert failed (lastId=${lastId}):`, err);
      failed += users.length;
      // Move cursor forward so we don't loop forever on a bad batch
      lastId = users[users.length - 1].id;
      continue;
    }

    total  += insertedCount;
    lastId  = users[users.length - 1].id;

    // Small yield between pages to avoid saturating the connection pool
    await new Promise(r => setTimeout(r, 50));
  }

  if (failed > 0) {
    // Some batches failed — don't mark notified_live so next run retries them
    console.warn(`[EVENT-LIVE] ⚠️  ${failed} users may be missed for "${title}" — will retry`);
    return;
  }

  // Mark the event only after all pages complete without failures
  await pool.query(
    `UPDATE "${table}" SET notified_live = true WHERE id = $1`,
    [eventId],
  );

  console.log(`[EVENT-LIVE] 🔴 Notified ${total} citizens — "${title}"`);
}

async function checkNewLiveEvents(): Promise<void> {
  if (!pool) return;
  try {
    // ── pulse_events ────────────────────────────────────────────────────────
    const { rows: pulseRows } = await pool.query<{
      id: number; title: string; icon: string;
    }>(
      `SELECT id, title, icon FROM pulse_events
       WHERE is_live = true AND notified_live = false`,
    );
    for (const ev of pulseRows) {
      await fanOutEventLive(ev.id, ev.title, ev.icon, "/pulse", "pulse_events");
    }

    // ── legend_arena_events ─────────────────────────────────────────────────
    const { rows: arenaRows } = await pool.query<{
      id: number; title: string; icon: string; legend_id: number | null;
    }>(
      `SELECT id, title, icon, legend_id FROM legend_arena_events
       WHERE is_live = true AND notified_live = false`,
    );
    for (const ev of arenaRows) {
      const linkPath = ev.legend_id ? `/legends/${ev.legend_id}` : "/legends";
      await fanOutEventLive(ev.id, ev.title, ev.icon, linkPath, "legend_arena_events");
    }
  } catch (err) {
    console.warn("[EVENT-LIVE] Job error:", err);
  }
}

export function startEventLiveAlertJob() {
  console.log("[EVENT-LIVE] 🔴 Event-Live Alert Job — ONLINE");
  // First check after 15s (tables + source_ref column + unique index must be ready)
  setTimeout(() => void checkNewLiveEvents(), 15_000);
  // Then every 60s
  setInterval(() => void checkNewLiveEvents(), 60_000);
}
