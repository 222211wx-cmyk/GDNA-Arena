import { Router, type IRouter } from "express";
import { eq, desc, sql, and, ne, gt } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db, dmRooms, dmRoomMembers, dmMessages, usersTable } from "@workspace/db";
import { validateContent } from "../lib/moderate";
import { isStarAccount, generateStarReply, hasStarInvite, type StarDef } from "./stars";

const router: IRouter = Router();

// ── Attachment URL validator ───────────────────────────────────────────────────
// Accepts https URLs and our own uploaded-attachment paths (/api/messages/files/…)
export function isValidAttachmentUrl(url: string): boolean {
  if (typeof url !== "string" || url.length > 2000) return false;
  if (/^\/api\/messages\/files\/[A-Za-z0-9._-]+$/.test(url)) return true;
  try { return new URL(url).protocol === "https:"; } catch { return false; }
}

// ── Chat attachment uploads (gallery, camera, files, voice notes) ─────────────
const chatUploadsDir = path.join(process.cwd(), "uploads", "chat");
if (!fs.existsSync(chatUploadsDir)) fs.mkdirSync(chatUploadsDir, { recursive: true });

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

const chatUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, chatUploadsDir),
    filename: (_req, file, cb) => {
      const ext = MIME_EXT[file.mimetype] ?? ".bin";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
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
    if (err) { res.status(400).json({ error: err.message ?? "Upload failed" }); return; }
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
router.get("/messages/files/:name", (req, res): void => {
  if (!req.session?.userId) { res.status(401).json({ error: "Login required" }); return; }
  const name = req.params.name;
  if (!/^[A-Za-z0-9._-]+$/.test(name)) { res.status(400).json({ error: "Bad name" }); return; }
  const filePath = path.join(chatUploadsDir, name);
  if (!filePath.startsWith(chatUploadsDir) || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "Not found" }); return;
  }
  // Content-Type derives from the server-chosen extension only; never sniff.
  const ext = path.extname(name).toLowerCase();
  const mime = Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", mime);
  if (!INLINE_SAFE.test(mime)) res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
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

// ── GET /messages/rooms — list my rooms ───────────────────────────────────────
router.get("/messages/rooms", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }

  const myMemberships = await db.select()
    .from(dmRoomMembers).where(eq(dmRoomMembers.userId, userId));

  if (myMemberships.length === 0) { res.json({ rooms: [] }); return; }

  const rooms = await Promise.all(myMemberships.map(async (membership) => {
    const { roomId, lastReadAt } = membership;
    const [room] = await db.select().from(dmRooms).where(eq(dmRooms.id, roomId)).limit(1);
    if (!room) return null;
    const members = await db.select().from(dmRoomMembers).where(eq(dmRoomMembers.roomId, roomId));
    const [lastMsg] = await db.select().from(dmMessages)
      .where(eq(dmMessages.roomId, roomId))
      .orderBy(desc(dmMessages.createdAt)).limit(1);
    const cnt = await unreadCount(roomId, userId, lastReadAt ?? null);
    return { ...room, members, lastMessage: lastMsg ?? null, unreadCount: cnt };
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

  const members = await db.select().from(dmRoomMembers).where(eq(dmRoomMembers.roomId, roomId));
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
    const check = await validateContent(content, { allowTrivial: hasAttachment || starPeer !== null });
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

  res.status(201).json({ message: msg, xpEarned });
});

// ── GET /messages/unread-count ────────────────────────────────────────────────
router.get("/messages/unread-count", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.json({ count: 0 }); return; }

  const memberships = await db.select()
    .from(dmRoomMembers).where(eq(dmRoomMembers.userId, userId));
  if (memberships.length === 0) { res.json({ count: 0 }); return; }

  let count = 0;
  for (const m of memberships) {
    count += await unreadCount(m.roomId, userId, m.lastReadAt ?? null);
  }
  res.json({ count });
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
