import { Router, type IRouter } from "express";
import { eq, desc, sql, and, ne, gt } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db, dmRooms, dmRoomMembers, dmMessages, usersTable, pool as _pool } from "@workspace/db";
import { gcsChatStorage, getChatObject, chatObjectStream, migrateLegacyChatUploads } from "../lib/chatStorage";
import { validateContent } from "../lib/moderate";
import { isStarAccount, generateStarReply, hasStarInvite, type StarDef } from "./stars";
import { broadcastMessageToRoom } from "../lib/signaling";
import {
  SendArenaWithdrawRequestBody,
  SendArenaWithdrawRequestResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const pool = _pool!;
const CHAT_MODERATION_BUDGET_MS = 300;
const ARENA_WITHDRAW_GAMES = {
  "neon-racer": "Neon Racer",
  "crypto-clash": "Crypto Clash",
  "arena-strike": "Arena Strike",
  globalstar: "GlobalStar",
} as const;

// Direct messages must not wait on a variable-latency external moderation
// request before appearing in the active conversation. validateContent performs
// its local blocklist, spam, and trivial-content checks synchronously before
// awaiting OpenAI; after that budget we preserve the guardian's established
// fail-open behavior for unavailable moderation rather than reintroducing a
// visible multi-second delivery delay.
async function validateChatContent(content: string, allowTrivial: boolean) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      validateContent(content, { allowTrivial }),
      new Promise<{ ok: true }>(resolve => {
        timer = setTimeout(() => resolve({ ok: true }), CHAT_MODERATION_BUDGET_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Attachment URL validator ───────────────────────────────────────────────────
// Accepts https URLs and our own uploaded-attachment paths (/api/messages/files/…)
export function isValidAttachmentUrl(url: string): boolean {
  if (typeof url !== "string" || url.length > 2000) return false;
  if (/^\/api\/messages\/files\/[A-Za-z0-9._-]+$/.test(url)) return true;
  try { return new URL(url).protocol === "https:"; } catch { return false; }
}

// ── Chat attachment uploads (gallery, camera, files, voice notes) ─────────────
// Attachments live in Replit App Storage (GCS bucket) so they survive
// production republishes. The legacy local dir is kept read-only as a
// fallback for files uploaded before the migration.
const legacyChatUploadsDir = path.join(process.cwd(), "uploads", "chat");

// Strict MIME → extension matrix. The stored extension is ALWAYS chosen by the
// server from this map — never from the client filename — so active content
// (.html, .svg, .js …) can never be persisted or served with a dangerous type.
const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp",
  "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
  "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/webm": ".weba",
  "audio/ogg": ".ogg", "audio/wav": ".wav",
  "application/pdf": ".pdf", "text/plain": ".txt", "application/zip": ".zip",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};
// Types safe to render inline; everything else is forced to download
const INLINE_SAFE = /^(image\/(jpeg|png|gif|webp)|video\/|audio\/)/;

const mimeForExt = (ext: string): string =>
  Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";

// One-time, idempotent rescue of any pre-migration files still on local disk.
// Runs in the background at boot; already-migrated objects are skipped.
migrateLegacyChatUploads(legacyChatUploadsDir, mimeForExt).catch(e =>
  console.error("Legacy chat upload migration error:", e));

// Uploads STREAM directly into the bucket (no memory buffering, no local disk).
// Filename/extension is ALWAYS server-chosen from MIME_EXT — never the client name.
const chatUpload = multer({
  storage: gcsChatStorage((mimetype) => {
    const ext = MIME_EXT[mimetype] ?? ".bin";
    return `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (_req, file, cb) => {
    if (MIME_EXT[file.mimetype]) cb(null, true);
    else cb(new Error("نوع الملف غير مسموح"));
  },
});

// Per-user upload rate limit (in-memory): max 15 uploads / 10 minutes
const uploadHistory = new Map<number, number[]>();
function uploadAllowed(userId: number): boolean {
  const now = Date.now();
  const recent = (uploadHistory.get(userId) ?? []).filter(t => now - t < 10 * 60 * 1000);
  if (recent.length >= 15) { uploadHistory.set(userId, recent); return false; }
  recent.push(now);
  uploadHistory.set(userId, recent);
  return true;
}

// POST /messages/upload — upload one attachment, returns its URL + kind
router.post("/messages/upload", (req, res): void => {
  const uploaderId = req.session?.userId;
  if (!uploaderId) { res.status(401).json({ error: "Login required" }); return; }
  if (!uploadAllowed(uploaderId)) {
    res.status(429).json({ error: "تجاوزت الحد المسموح من الملفات — حاول بعد قليل ⏳" }); return;
  }
  chatUpload.single("file")(req, res, (err) => {
    if (err) {
      const status = err.code === "LIMIT_FILE_SIZE" || err.message?.includes("غير مسموح") ? 400 : 500;
      if (status === 500) console.error("Chat attachment upload to object storage failed:", err);
      res.status(status).json({ error: status === 500 ? "فشل رفع الملف — حاول مرة أخرى" : (err.message ?? "Upload failed") });
      return;
    }
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const mime = req.file.mimetype;
    const kind = mime.startsWith("image/") ? "image"
      : mime.startsWith("video/") ? "video"
      : mime.startsWith("audio/") ? "audio" : "file";
    res.json({
      url: `/api/messages/files/${req.file.filename}`,
      kind,
      name: req.file.originalname,
      size: req.file.size,
    });
  });
});

// GET /messages/files/:name — serve an uploaded attachment (login required)
router.get("/messages/files/:name", async (req, res): Promise<void> => {
  if (!req.session?.userId) { res.status(401).json({ error: "Login required" }); return; }
  const name = req.params.name;
  if (!/^[A-Za-z0-9._-]+$/.test(name)) { res.status(400).json({ error: "Bad name" }); return; }

  // Content-Type derives from the server-chosen extension only; never sniff.
  const mime = mimeForExt(path.extname(name).toLowerCase());
  const setSecurityHeaders = () => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (!INLINE_SAFE.test(mime)) res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  };

  try {
    const file = await getChatObject(name);
    if (file) {
      setSecurityHeaders();
      chatObjectStream(file)
        .on("error", (e) => {
          console.error("Chat attachment stream error:", e);
          if (!res.headersSent) res.status(500).json({ error: "Read failed" });
          else res.destroy();
        })
        .pipe(res);
      return;
    }
  } catch (e) {
    console.error("Chat attachment lookup failed:", e);
    res.status(500).json({ error: "Storage unavailable" }); return;
  }

  // Legacy fallback: files uploaded before the object-storage migration
  const filePath = path.join(legacyChatUploadsDir, name);
  if (!filePath.startsWith(legacyChatUploadsDir) || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "Not found" }); return;
  }
  setSecurityHeaders();
  res.sendFile(filePath);
});

// ── Helper: get membership row (null if not a member) ─────────────────────────
async function getMembership(roomId: number, userId: number) {
  const [row] = await db.select()
    .from(dmRoomMembers)
    .where(and(eq(dmRoomMembers.roomId, roomId), eq(dmRoomMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

// ── Per-room unread count for one user (messages from others after their cursor)
async function unreadCount(roomId: number, userId: number, lastReadAt: Date | null): Promise<number> {
  const cursor = lastReadAt ?? new Date(0);
  const [r] = await db.select({ cnt: sql<number>`count(*)::int` })
    .from(dmMessages)
    .where(and(
      eq(dmMessages.roomId, roomId),
      ne(dmMessages.userId, userId),
      gt(dmMessages.createdAt, cursor),
    ));
  return r?.cnt ?? 0;
}

// Privacy: read cursors are only useful when both sides have receipts enabled.
// A member who disables receipts neither shares their cursor nor sees peers'
// cursors. Their own cursor is kept for the viewer themself (it only drives
// their private unread badge).
type MemberRow = typeof dmRoomMembers.$inferSelect;
async function hideReadCursors<T extends MemberRow>(members: T[], viewerId: number): Promise<T[]> {
  const otherIds = members.map(m => m.userId).filter(id => id !== viewerId);
  if (otherIds.length === 0) return members;
  const r = await pool.query(
    `SELECT user_id, read_receipts FROM dm_user_settings WHERE user_id = ANY($1)`,
    [[viewerId, ...otherIds]]);
  const receiptsByUser = new Map<number, boolean>(
    r.rows.map((row: { user_id: number; read_receipts: boolean }) => [row.user_id, row.read_receipts]));
  const viewerShares = receiptsByUser.get(viewerId) ?? true;
  return members.map(m => {
    if (m.userId === viewerId) return m;
    const peerShares = receiptsByUser.get(m.userId) ?? true;
    return viewerShares && peerShares ? m : { ...m, lastReadAt: null };
  });
}

// ── GET /messages/rooms — list my rooms ───────────────────────────────────────
router.get("/messages/rooms", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }

  const myMemberships = await db.select()
    .from(dmRoomMembers).where(eq(dmRoomMembers.userId, userId));

  if (myMemberships.length === 0) { res.json({ rooms: [] }); return; }

  // muted flag lives in a raw column (added by DDL, not in the drizzle schema)
  const mutedRes = await pool.query(
    `SELECT room_id FROM dm_room_members WHERE user_id = $1 AND muted`, [userId]);
  const mutedSet = new Set<number>(mutedRes.rows.map((r: { room_id: number }) => r.room_id));

  const rooms = await Promise.all(myMemberships.map(async (membership) => {
    const { roomId, lastReadAt } = membership;
    const [room] = await db.select().from(dmRooms).where(eq(dmRooms.id, roomId)).limit(1);
    if (!room) return null;
    const members = await hideReadCursors(
      await db.select().from(dmRoomMembers).where(eq(dmRoomMembers.roomId, roomId)), userId);
    const [lastMsg] = await db.select().from(dmMessages)
      .where(eq(dmMessages.roomId, roomId))
      .orderBy(desc(dmMessages.createdAt)).limit(1);
    const cnt = await unreadCount(roomId, userId, lastReadAt ?? null);
    return { ...room, members, lastMessage: lastMsg ?? null, unreadCount: cnt, muted: mutedSet.has(roomId) };
  }));

  res.json({ rooms: rooms.filter(Boolean) });
});

// ── POST /messages/rooms — create or find DM room ────────────────────────────
router.post("/messages/rooms", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }

  const { targetUsername, roomName, type = "direct", icon = "💬" } = req.body as {
    targetUsername?: string; roomName?: string; type?: string; icon?: string;
  };

  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  if (type === "direct" && targetUsername) {
    const [target] = await db.select().from(usersTable)
      .where(eq(usersTable.username, targetUsername)).limit(1);
    if (!target) { res.status(404).json({ error: "Citizen not found" }); return; }
    if (target.id === userId) { res.status(400).json({ error: "Cannot DM yourself" }); return; }

    // Return existing DM if one already exists between these two users
    const myDMs = await db.select({ roomId: dmRoomMembers.roomId })
      .from(dmRoomMembers).where(eq(dmRoomMembers.userId, userId));
    for (const { roomId } of myDMs) {
      const [room] = await db.select().from(dmRooms)
        .where(and(eq(dmRooms.id, roomId), eq(dmRooms.type, "direct"))).limit(1);
      if (!room) continue;
      const members = await db.select().from(dmRoomMembers).where(eq(dmRoomMembers.roomId, roomId));
      if (members.length === 2 && members.some(m => m.userId === target.id)) {
        res.json({ room }); return;
      }
    }

    const [room] = await db.insert(dmRooms).values({ type: "direct", createdBy: userId }).returning();
    await db.insert(dmRoomMembers).values([
      { roomId: room.id, userId: me.id,     username: me.username },
      { roomId: room.id, userId: target.id, username: target.username },
    ]);
    res.status(201).json({ room });
  } else {
    const [room] = await db.insert(dmRooms).values({
      type: "group", name: roomName ?? "Group Room", icon, createdBy: userId,
    }).returning();
    await db.insert(dmRoomMembers).values({ roomId: room.id, userId: me.id, username: me.username });
    res.status(201).json({ room });
  }
});

// ── POST /messages/arena-withdraw — send a fixed prize request to Arena admin ─
router.post("/messages/arena-withdraw", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }

  const parsed = SendArenaWithdrawRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid game" });
    return;
  }

  const [me] = await db.select().from(usersTable)
    .where(eq(usersTable.id, userId)).limit(1);
  if (!me) { res.status(401).json({ error: "Login required" }); return; }

  const [arenaAdmin] = await db.select().from(usersTable)
    .where(and(eq(usersTable.isAdmin, true), ne(usersTable.id, userId)))
    .orderBy(usersTable.id)
    .limit(1);
  if (!arenaAdmin) {
    res.status(503).json({ error: "إدارة Arena غير متاحة حالياً" });
    return;
  }

  const content = `طلب جائزة من ${ARENA_WITHDRAW_GAMES[parsed.data.gameId]}`;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Serialize find-or-create by the canonical citizen/admin pair so parallel
    // requests cannot split the same direct conversation into duplicate rooms.
    const lockKeyA = Math.min(userId, arenaAdmin.id);
    const lockKeyB = Math.max(userId, arenaAdmin.id);
    await client.query(
      "SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
      [lockKeyA, lockKeyB],
    );

    const existingRoom = await client.query<{ id: number }>(
      `SELECT r.id
       FROM dm_rooms r
       JOIN dm_room_members m ON m.room_id = r.id
       WHERE r.type = 'direct'
       GROUP BY r.id
       HAVING COUNT(*) = 2
          AND COUNT(DISTINCT m.user_id) FILTER (
            WHERE m.user_id = $1 OR m.user_id = $2
          ) = 2
       ORDER BY r.id
       LIMIT 1`,
      [userId, arenaAdmin.id],
    );

    let roomId = existingRoom.rows[0]?.id;
    if (!roomId) {
      const createdRoom = await client.query<{ id: number }>(
        `INSERT INTO dm_rooms (type, created_by)
         VALUES ('direct', $1)
         RETURNING id`,
        [userId],
      );
      roomId = createdRoom.rows[0].id;

      await client.query(
        `INSERT INTO dm_room_members (room_id, user_id, username)
         VALUES ($1, $2, $3), ($1, $4, $5)`,
        [roomId, me.id, me.username, arenaAdmin.id, arenaAdmin.username],
      );
    }

    const insertedMessage = await client.query(
      `INSERT INTO dm_messages (room_id, user_id, username, content, type)
       VALUES ($1, $2, $3, $4, 'text')
       RETURNING
         id,
         room_id AS "roomId",
         user_id AS "userId",
         username,
         content,
         audio_url AS "audioUrl",
         video_url AS "videoUrl",
         file_url AS "fileUrl",
         type,
         is_read AS "isRead",
         created_at AS "createdAt"`,
      [roomId, userId, me.username, content],
    );

    await client.query("COMMIT");

    void broadcastMessageToRoom(roomId, insertedMessage.rows[0]).catch(error =>
      req.log.error({ error, roomId }, "Arena withdrawal message realtime broadcast failed"));

    res.status(201).json(SendArenaWithdrawRequestResponse.parse({
      ok: true,
      roomId,
      content,
    }));
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      req.log.error({ rollbackError }, "Arena withdrawal transaction rollback failed");
    }
    req.log.error({ error, userId }, "Arena withdrawal request failed");
    res.status(500).json({ error: "تعذر إرسال الطلب" });
  } finally {
    client.release();
  }
});

// ── POST /messages/rooms/:id/join — group rooms only ──────────────────────────
router.post("/messages/rooms/:id/join", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = parseInt(req.params.id);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const [room] = await db.select().from(dmRooms).where(eq(dmRooms.id, roomId)).limit(1);
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }
  if (room.type !== "group") {
    res.status(403).json({ error: "Cannot join a private direct room" }); return;
  }

  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const already = await getMembership(roomId, userId);
  if (!already) {
    await db.insert(dmRoomMembers).values({ roomId, userId, username: me.username });
  }
  res.json({ ok: true });
});

// ── GET /messages/rooms/:id — fetch messages (members only) ───────────────────
router.get("/messages/rooms/:id", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = parseInt(req.params.id);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const membership = await getMembership(roomId, userId);
  if (!membership) {
    res.status(403).json({ error: "Access denied — not a member of this room" }); return;
  }

  const msgs = await db.select().from(dmMessages)
    .where(eq(dmMessages.roomId, roomId))
    .orderBy(desc(dmMessages.createdAt)).limit(60);

  const members = await hideReadCursors(
    await db.select().from(dmRoomMembers).where(eq(dmRoomMembers.roomId, roomId)), userId);
  const [room]  = await db.select().from(dmRooms).where(eq(dmRooms.id, roomId)).limit(1);

  // Advance this member's read cursor to the latest fetched message timestamp.
  // The WHERE guard ensures the cursor is strictly monotonic — concurrent reads
  // cannot move it backward and cause already-read messages to reappear as unread.
  const latestTs = msgs.length > 0 ? msgs[0]!.createdAt : null;
  if (latestTs) {
    await db.update(dmRoomMembers)
      .set({ lastReadAt: latestTs })
      .where(and(
        eq(dmRoomMembers.roomId, roomId),
        eq(dmRoomMembers.userId, userId),
        sql`(${dmRoomMembers.lastReadAt} IS NULL OR ${dmRoomMembers.lastReadAt} < ${latestTs})`,
      ));
  }

  res.json({ room, messages: msgs.reverse(), members });
});

// ── POST /messages/rooms/:id/send (members only) ──────────────────────────────
router.post("/messages/rooms/:id/send", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = parseInt(req.params.id);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  // Membership gate — prevents IDOR and XP farming from external rooms
  const membership = await getMembership(roomId, userId);
  if (!membership) {
    res.status(403).json({ error: "Access denied — not a member of this room" }); return;
  }

  const { content, audioUrl, videoUrl, fileUrl, type = "text" } = req.body as {
    content?: string; audioUrl?: string; videoUrl?: string; fileUrl?: string; type?: string;
  };

  if (!content?.trim() && !audioUrl && !videoUrl && !fileUrl) {
    res.status(400).json({ error: "Message content required" }); return;
  }

  // Validate all attachment URLs (incoming branch: must be https, ≤2000 chars)
  for (const url of [audioUrl, videoUrl, fileUrl]) {
    if (url !== undefined && !isValidAttachmentUrl(url)) {
      res.status(400).json({ error: "Invalid attachment URL — must be https and under 2000 chars" }); return;
    }
  }

  // ⭐ Detect a Stars Hall room early: 1:1 with a hosted world star.
  // Casual/short messages are allowed there — it's a conversation, not a feed.
  const roomMembers = await db.select({ userId: dmRoomMembers.userId })
    .from(dmRoomMembers).where(eq(dmRoomMembers.roomId, roomId));
  const otherIds = roomMembers.map(m => m.userId).filter((id): id is number => id !== null && id !== userId);
  let starPeer: { id: number; username: string; def: StarDef } | null = null;
  if (otherIds.length === 1) {
    const [other] = await db.select({ id: usersTable.id, username: usersTable.username, email: usersTable.email })
      .from(usersTable).where(eq(usersTable.id, otherIds[0])).limit(1);
    const def = other ? isStarAccount(other) : null;
    if (other && def) starPeer = { id: other.id, username: other.username, def };
  }

  if (content) {
    const hasAttachment = Boolean(audioUrl ?? videoUrl ?? fileUrl);
    const check = await validateChatContent(content, hasAttachment || starPeer !== null);
    if (!check.ok) { res.status(400).json({ error: check.reason }); return; }
  }

  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const [msg] = await db.insert(dmMessages).values({
    roomId, userId, username: me.username,
    content: content?.trim() ?? null,
    audioUrl: audioUrl ?? null, videoUrl: videoUrl ?? null,
    fileUrl: fileUrl ?? null, type,
  }).returning();

  // XP reward: atomic conditional UPDATE — only awards when:
  //   1. The room has at least one other member (prevents solo-room farming)
  //   2. The per-user DB-backed cooldown has elapsed (60 s)
  // The WHERE clause makes both the eligibility check and the award happen in a
  // single statement, so concurrent requests cannot both pass and double-award.
  const hasOtherMember = roomMembers.some(m => m.userId !== userId);

  let xpEarned = 0;
  if (hasOtherMember) {
    const awarded = await db.update(usersTable)
      .set({
        xp: sql`${usersTable.xp} + 5`,
        lastDmXpAt: sql`now()`,
      })
      .where(and(
        eq(usersTable.id, userId),
        sql`(${usersTable.lastDmXpAt} IS NULL OR ${usersTable.lastDmXpAt} < now() - interval '60 seconds')`,
      ))
      .returning({ id: usersTable.id });
    if (awarded.length > 0) xpEarned = 5;
  }

  // ⭐ Stars Hall: the empire's internal intelligence replies in the star's
  // persona — only for citizens holding a real invite entitlement (no cost bypass).
  if (content?.trim() && starPeer && await hasStarInvite(userId, starPeer.username)) {
    generateStarReply(roomId, starPeer.def, starPeer.id, me.username, content.trim()).catch(() => {});
  }

  // The persisted message is delivered through the authenticated signaling
  // channel to the room members resolved above on the server. Failure to push
  // must not turn a saved message into a failed send; REST recovery remains.
  void broadcastMessageToRoom(roomId, msg).catch(error =>
    console.error("Chat realtime broadcast failed:", error));
  res.status(201).json({ message: msg, xpEarned });
});

// ── GET /messages/unread-count ────────────────────────────────────────────────
router.get("/messages/unread-count", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.json({ count: 0 }); return; }

  const memberships = await db.select()
    .from(dmRoomMembers).where(eq(dmRoomMembers.userId, userId));
  if (memberships.length === 0) { res.json({ count: 0 }); return; }

  // Muted conversations don't contribute to the badge
  const mutedRes = await pool.query(
    `SELECT room_id FROM dm_room_members WHERE user_id = $1 AND muted`, [userId]);
  const mutedSet = new Set<number>(mutedRes.rows.map((r: { room_id: number }) => r.room_id));

  let count = 0;
  for (const m of memberships) {
    if (mutedSet.has(m.roomId)) continue;
    count += await unreadCount(m.roomId, userId, m.lastReadAt ?? null);
  }
  res.json({ count });
});

// ── DELETE /messages/rooms/:roomId/messages/:msgId — unsend own message ───────
router.delete("/messages/rooms/:roomId/messages/:msgId", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = parseInt(req.params.roomId);
  const msgId  = parseInt(req.params.msgId);
  if (isNaN(roomId) || isNaN(msgId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const membership = await getMembership(roomId, userId);
  if (!membership) { res.status(403).json({ error: "Access denied — not a member of this room" }); return; }

  // Only the author can delete their own message — enforced in the WHERE clause
  const deleted = await db.delete(dmMessages)
    .where(and(eq(dmMessages.id, msgId), eq(dmMessages.roomId, roomId), eq(dmMessages.userId, userId)))
    .returning({ id: dmMessages.id });
  if (deleted.length === 0) {
    res.status(403).json({ error: "يمكنك حذف رسائلك فقط — Vous ne pouvez supprimer que vos propres messages" }); return;
  }
  res.json({ deleted: true });
});

// ── DELETE /messages/rooms/:roomId — leave/delete a conversation ──────────────
router.delete("/messages/rooms/:roomId", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = parseInt(req.params.roomId);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  // Lock the room while changing its membership. This makes simultaneous exits
  // safe: the last person leaving a direct conversation removes the now-orphaned
  // room and its messages, while the other participant keeps their own membership
  // and conversation until they choose to leave as well.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: roomRows } = await client.query<{ type: string }>(
      `SELECT type FROM dm_rooms WHERE id = $1 FOR UPDATE`,
      [roomId],
    );
    const room = roomRows[0];
    if (!room) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Room not found" }); return;
    }

    const { rowCount } = await client.query(
      `DELETE FROM dm_room_members WHERE room_id = $1 AND user_id = $2`,
      [roomId, userId],
    );
    if (rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(403).json({ error: "Access denied — not a member of this room" }); return;
    }

    let roomDeleted = false;
    if (room.type === "direct") {
      const { rows: remainingRows } = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM dm_room_members WHERE room_id = $1`,
        [roomId],
      );
      if ((remainingRows[0]?.count ?? 0) === 0) {
        await client.query(`DELETE FROM dm_messages WHERE room_id = $1`, [roomId]);
        await client.query(`DELETE FROM dm_rooms WHERE id = $1`, [roomId]);
        roomDeleted = true;
      }
    }

    await client.query("COMMIT");
    res.json({ deleted: true, roomDeleted });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* transaction already finished */ }
    throw error;
  } finally {
    client.release();
  }
});

// ── POST /messages/rooms/:id/mute — mute/unmute a conversation ────────────────
router.post("/messages/rooms/:id/mute", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = parseInt(req.params.id);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }
  const membership = await getMembership(roomId, userId);
  if (!membership) { res.status(403).json({ error: "Access denied" }); return; }
  const muted = req.body?.muted === true;
  await pool.query(`UPDATE dm_room_members SET muted = $1 WHERE room_id = $2 AND user_id = $3`,
    [muted, roomId, userId]);
  res.json({ muted });
});

// ── GET /messages/settings — per-user messenger settings ─────────────────────
router.get("/messages/settings", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const { rows } = await pool.query(
    `SELECT notifications, read_receipts FROM dm_user_settings WHERE user_id = $1`, [userId]);
  res.json({
    notifications: rows[0]?.notifications ?? true,
    readReceipts:  rows[0]?.read_receipts ?? true,
  });
});

// ── POST /messages/settings ───────────────────────────────────────────────────
router.post("/messages/settings", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const { notifications, readReceipts } = req.body as { notifications?: boolean; readReceipts?: boolean };
  if (typeof notifications !== "boolean" && typeof readReceipts !== "boolean") {
    res.status(400).json({ error: "Nothing to update" }); return;
  }
  await pool.query(
    `INSERT INTO dm_user_settings (user_id, notifications, read_receipts)
     VALUES ($1, COALESCE($2, true), COALESCE($3, true))
     ON CONFLICT (user_id) DO UPDATE SET
       notifications = COALESCE($2, dm_user_settings.notifications),
       read_receipts = COALESCE($3, dm_user_settings.read_receipts),
       updated_at = now()`,
    [userId, notifications ?? null, readReceipts ?? null]);
  const { rows } = await pool.query(
    `SELECT notifications, read_receipts FROM dm_user_settings WHERE user_id = $1`, [userId]);
  res.json({ notifications: rows[0].notifications, readReceipts: rows[0].read_receipts });
});

// ── GET /messages/group-rooms — public group rooms list ───────────────────────
router.get("/messages/group-rooms", async (_req, res): Promise<void> => {
  const rooms = await db.select().from(dmRooms)
    .where(eq(dmRooms.type, "group")).orderBy(desc(dmRooms.createdAt)).limit(20);
  const withMembers = await Promise.all(rooms.map(async r => {
    const members = await db.select().from(dmRoomMembers).where(eq(dmRoomMembers.roomId, r.id));
    return { ...r, memberCount: members.length };
  }));
  res.json({ rooms: withMembers });
});

export default router;
