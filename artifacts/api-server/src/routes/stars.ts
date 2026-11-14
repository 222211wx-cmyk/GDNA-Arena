import { requireMessagingSubscription } from "../middleware/require-messaging-subscription";
// ══════════════════════════════════════════════════════════════════════════════
//  GDNA STARS HALL — World stars as honorary citizens, hosted through the
//  empire's internal intelligence. Citizens can invite a limited number of
//  stars per day; stars reply to DMs via the internal AI (GDN-SMART core).
// ══════════════════════════════════════════════════════════════════════════════

import { Router, type IRouter } from "express";
import bcrypt from "bcrypt";
import { db, pool, dmRooms, dmRoomMembers, dmMessages, usersTable } from "../lib/db";
import { eq } from "drizzle-orm";
import { notifyMessageRecipients } from "../lib/message-push";
import { citizenProjection } from "../lib/citizen-projection";
import { AI_UNAVAILABLE_MESSAGE, createOptionalOpenAI, isOpenAIAvailable } from "../lib/openai-client";

const router: IRouter = Router();
const openai = createOptionalOpenAI();

const DAILY_INVITE_LIMIT = 3;

// ── Star roster: honorary citizens hosted by the empire ──────────────────────
export interface StarDef {
  username: string;
  fullName: string;
  domain: "sport" | "music" | "cinema";
  nationality: string;
  persona: string; // AI persona brief (English — model output adapts to citizen's language)
}

export const STARS: StarDef[] = [
  { username: "Cristiano_Ronaldo", fullName: "Cristiano Ronaldo", domain: "sport",  nationality: "Portugal",
    persona: "Football legend CR7. Confident, disciplined, motivational. Talks about hard work, SIUUU energy, never settling." },
  { username: "Lionel_Messi",      fullName: "Lionel Messi",      domain: "sport",  nationality: "Argentina",
    persona: "Humble football genius. Soft-spoken, kind, lets the game talk. Values family and quiet persistence." },
  { username: "LeBron_James",      fullName: "LeBron James",      domain: "sport",  nationality: "USA",
    persona: "Basketball king. Leadership, longevity, community. Big brother energy, strive for greatness." },
  { username: "Serena_Williams",   fullName: "Serena Williams",   domain: "sport",  nationality: "USA",
    persona: "Tennis champion. Fierce, resilient, empowering — a champion rises from every defeat." },
  { username: "Roger_Federer",     fullName: "Roger Federer",     domain: "sport",  nationality: "Switzerland",
    persona: "Tennis maestro. Elegant, gracious, calm wisdom about craft and composure." },
  { username: "Beyonce",           fullName: "Beyoncé",           domain: "music",  nationality: "USA",
    persona: "Queen B. Excellence, discipline, artistry, empowerment. Regal but warm." },
  { username: "Eminem",            fullName: "Eminem",            domain: "music",  nationality: "USA",
    persona: "Rap god. Sharp wordplay, brutally honest, underdog grit — lose yourself in the moment." },
  { username: "Taylor_Swift",      fullName: "Taylor Swift",      domain: "music",  nationality: "USA",
    persona: "Songwriting phenomenon. Storyteller, warm, witty, turns feelings into anthems." },
  { username: "Shakira",           fullName: "Shakira",           domain: "music",  nationality: "Colombia",
    persona: "Global music icon. Multilingual, joyful, dance and resilience — hips don't lie." },
  { username: "Leonardo_DiCaprio", fullName: "Leonardo DiCaprio", domain: "cinema", nationality: "USA",
    persona: "Cinema star and environmentalist. Thoughtful about craft, passionate about the planet." },
  { username: "Morgan_Freeman",    fullName: "Morgan Freeman",    domain: "cinema", nationality: "USA",
    persona: "The voice of wisdom. Calm gravitas, gentle humor, profound one-liners." },
  { username: "Denzel_Washington", fullName: "Denzel Washington", domain: "cinema", nationality: "USA",
    persona: "Acting titan. Discipline, faith, dignity — ease is a greater threat to progress than hardship." },
];

const STAR_BY_USERNAME = new Map(STARS.map(s => [s.username.toLowerCase(), s]));

export function getStarDef(username: string): StarDef | undefined {
  return STAR_BY_USERNAME.get(username.toLowerCase());
}

// Reserved service-account email — the ONLY identity accepted as a star.
// A pre-existing citizen who happens to share a roster username is NOT a star.
export function starEmail(s: StarDef): string {
  return `${s.username.toLowerCase()}@stars.gdna.empire`;
}

/** Verify a user row is a genuine seeded star service account. */
export function isStarAccount(user: { username: string; email: string }): StarDef | null {
  const def = getStarDef(user.username);
  if (!def) return null;
  return user.email === starEmail(def) ? def : null;
}

// ── One-time setup: is_star column, invites table, seed star accounts ─────────
export async function ensureStarsSystem(): Promise<void> {
  if (!pool) return;
  await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_star" BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS star_invites (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      star_username TEXT NOT NULL,
      date_key TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, star_username)
    )`);

  const { randomBytes } = await import("node:crypto");
  for (const s of STARS) {
    // Distinct cryptographically-random password per star — never revealed,
    // so these service accounts are effectively non-loginable.
    // ON CONFLICT DO NOTHING: never convert a pre-existing citizen into a star.
    const hash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    await pool.query(
      `INSERT INTO "users" (username, email, password_hash, xp, balance, is_star)
       VALUES ($1, $2, $3, 99999, 99999, TRUE)
       ON CONFLICT (username) DO NOTHING`,
      [s.username, starEmail(s), hash],
    );
    // Ensure the flag is set only on the genuine service account
    await pool.query(
      `UPDATE "users" SET is_star = TRUE WHERE username = $1 AND email = $2`,
      [s.username, starEmail(s)],
    );
  }
  console.log(`[STARS] ⭐ Stars Hall ready — ${STARS.length} world stars hosted as honorary citizens`);
}

// ── GET /stars — roster + my invite status ────────────────────────────────────
router.get("/stars", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  const todayKey = new Date().toISOString().slice(0, 10);

  let invited: string[] = [];
  let usedToday = 0;
  if (userId && pool) {
    const { rows } = await pool.query(
      `SELECT star_username, date_key FROM star_invites WHERE user_id = $1`, [userId],
    );
    invited = rows.map((r: any) => r.star_username);
    usedToday = rows.filter((r: any) => r.date_key === todayKey).length;
  }

  res.json({
    stars: STARS.map(s => ({
      username: s.username, fullName: s.fullName, domain: s.domain,
      nationality: s.nationality, invited: invited.includes(s.username),
    })),
    dailyLimit: DAILY_INVITE_LIMIT,
    remainingToday: Math.max(0, DAILY_INVITE_LIMIT - usedToday),
  });
});

// ── POST /stars/invite — host a star (opens a DM room, star greets via AI) ───
router.post("/stars/invite", requireMessagingSubscription, async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const { starUsername } = req.body as { starUsername?: string };
  const star = starUsername ? getStarDef(starUsername) : undefined;
  if (!star) { res.status(400).json({ error: "نجم غير معروف في قاعة النجوم" }); return; }

  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  // Only the genuine seeded service account counts as the star
  const { rows: starRows } = await pool.query(
    `SELECT id, username FROM "users" WHERE username = $1 AND email = $2 AND is_star = TRUE LIMIT 1`,
    [star.username, starEmail(star)],
  );
  const starUser = starRows[0] as { id: number; username: string } | undefined;
  if (!starUser) { res.status(500).json({ error: "Star account missing" }); return; }
  if (!(await citizenProjection(starUser.id, userId))?.canMessage) {
    res.status(403).json({ error: "Direct messaging is unavailable for this citizen" }); return;
  }

  const todayKey = new Date().toISOString().slice(0, 10);

  // Transaction + per-user advisory lock: quota check, invite insert and room
  // creation are atomic — parallel requests cannot exceed the daily limit or
  // create duplicate rooms.
  const client = await pool.connect();
  let roomId: number;
  let created = false;
  let createdMessageId: number | null = null;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(842001, $1)`, [userId]);

    const { rows: existing } = await client.query(
      `SELECT id FROM star_invites WHERE user_id = $1 AND star_username = $2`, [userId, star.username],
    );
    if (existing.length === 0) {
      const { rows: todays } = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM star_invites WHERE user_id = $1 AND date_key = $2`,
        [userId, todayKey],
      );
      if ((todays[0]?.cnt ?? 0) >= DAILY_INVITE_LIMIT) {
        await client.query("ROLLBACK");
        res.status(429).json({ error: `وصلت حد الاستضافة اليومي (${DAILY_INVITE_LIMIT} نجوم) — عد غداً 👑` });
        return;
      }
      await client.query(
        `INSERT INTO star_invites (user_id, star_username, date_key) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, star_username) DO NOTHING`,
        [userId, star.username, todayKey],
      );
    }

    // Share the canonical pair lock with ordinary messaging and arena-withdraw.
    // The quota lock alone cannot serialize those other direct-room entry points.
    await client.query(
      "SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
      [Math.min(userId, starUser.id), Math.max(userId, starUser.id)],
    );
    // Reuse the oldest historical room; never rewrite IDs or move message history.
    const { rows: roomRows } = await client.query(
      `SELECT r.id FROM dm_rooms r
       JOIN dm_room_members a ON a.room_id = r.id AND a.user_id = $1
       JOIN dm_room_members b ON b.room_id = r.id AND b.user_id = $2
       WHERE r.type = 'direct'
         AND (SELECT COUNT(*) FROM dm_room_members m WHERE m.room_id = r.id) = 2
       ORDER BY r.id LIMIT 1`,
      [userId, starUser.id],
    );

    if (roomRows.length > 0) {
      roomId = roomRows[0].id;
    } else {
      // Membership changes serialize with encrypted insertion/key registration.
      await client.query("SELECT pg_advisory_xact_lock(47201, 1)");
      const { rows: newRoom } = await client.query(
        `INSERT INTO dm_rooms (type, created_by) VALUES ('direct', $1) RETURNING id`, [userId],
      );
      roomId = newRoom[0].id;
      await client.query(
        `INSERT INTO dm_room_members (room_id, user_id, username) VALUES ($1, $2, $3), ($1, $4, $5)`,
        [roomId, userId, me.username, starUser.id, starUser.username],
      );
      const welcomeMessage = await client.query<{ id: number }>(
        `INSERT INTO dm_messages (room_id, user_id, username, content, type)
         VALUES ($1, $2, $3, $4, 'text')
         RETURNING id`,
        [roomId, starUser.id, starUser.username,
         `👑 ${me.username}! ${star.fullName} here — honored to be hosted in your empire. Ask me anything.`],
      );
      createdMessageId = welcomeMessage.rows[0]?.id ?? null;
      created = true;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (createdMessageId !== null) {
    void notifyMessageRecipients(roomId, starUser.id, createdMessageId, starUser.username).catch(() => {});
  }
  res.json({ success: true, roomId, star: { username: star.username, fullName: star.fullName }, created });
});

// ── Entitlement check: has this citizen actually invited this star? ──────────
export async function hasStarInvite(userId: number, starUsername: string): Promise<boolean> {
  if (!pool) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM star_invites WHERE user_id = $1 AND star_username = $2 LIMIT 1`,
    [userId, starUsername],
  );
  return rows.length > 0;
}

// ── AI abuse guard: per-room cooldown + global concurrency cap ────────────────
const lastReplyAt = new Map<number, number>(); // roomId → epoch ms
let activeReplies = 0;
const REPLY_COOLDOWN_MS = 5000;
const MAX_CONCURRENT_REPLIES = 4;

function canGenerateReply(roomId: number): boolean {
  const now = Date.now();
  if (activeReplies >= MAX_CONCURRENT_REPLIES) return false;
  if (now - (lastReplyAt.get(roomId) ?? 0) < REPLY_COOLDOWN_MS) return false;
  lastReplyAt.set(roomId, now);
  return true;
}

// ── AI reply engine — the empire's internal intelligence speaks for the star ──
export async function generateStarReply(
  roomId: number,
  star: StarDef,
  starUserId: number,
  citizenUsername: string,
  _citizenMessage: string | null,
  replaceMessageId?: number,
): Promise<void> {
  if (!canGenerateReply(roomId)) return;
  activeReplies++;
  try {
    // Pull recent history for context
    const history = await db.select().from(dmMessages)
      .where(eq(dmMessages.roomId, roomId))
      .orderBy(dmMessages.createdAt)
      .limit(20);

    const chat = history
      .filter(m => m.content)
      .slice(-12)
      .map(m => ({
        role: (m.userId === starUserId ? "assistant" : "user") as "assistant" | "user",
        content: m.content as string,
      }));

    let reply: string | undefined;
    try {
      if (!isOpenAIAvailable()) throw new Error("AI provider unavailable");
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 220,
        temperature: 0.9,
        messages: [
          {
            role: "system",
            content: `You are ${star.fullName} (${star.nationality}), a world ${star.domain} star, hosted as an honorary citizen inside Arena Qaisypro — a black-and-gold digital empire. Persona: ${star.persona}
Rules:
- Stay warmly in character; you are chatting 1:1 with citizen "${citizenUsername}".
- ALWAYS reply in the same language the citizen writes in (Arabic → Arabic, Darija → Darija, French → French, English → English).
- Keep replies short (1-3 sentences), personal and motivational. Occasionally use 👑 or your signature style.
- Never break character, never mention being an AI. If asked, you are "${star.fullName}, hosted by Arena Qaisypro's intelligence".`,
          },
          ...chat,
        ],
      });

      reply = completion.choices[0]?.message?.content?.trim();
    } catch {
      reply = AI_UNAVAILABLE_MESSAGE;
    }
    if (!reply) return;

    if (replaceMessageId) {
      await db.update(dmMessages).set({ content: reply }).where(eq(dmMessages.id, replaceMessageId));
    } else {
      const [savedReply] = await db.insert(dmMessages).values({
        roomId, userId: starUserId, username: star.username, content: reply, type: "text",
      }).returning({ id: dmMessages.id });
      if (savedReply) {
        void notifyMessageRecipients(roomId, starUserId, savedReply.id, star.username).catch(() => {});
      }
    }
  } catch {
    // The background reply is best-effort; avoid exposing provider or storage details.
  } finally {
    activeReplies--;
  }
}

export default router;
