import { Router, type IRouter } from "express";
import { eq, desc, sql, and, or } from "drizzle-orm";
import { db, dmRooms, dmRoomMembers, dmMessages, usersTable, notifications } from "@workspace/db";
import { validateContent } from "../lib/moderate";

const router: IRouter = Router();

// ── GET /messages/rooms — list my rooms ───────────────────────────────────────
router.get("/messages/rooms", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }

  const myRooms = await db.select({
    roomId: dmRoomMembers.roomId,
  }).from(dmRoomMembers).where(eq(dmRoomMembers.userId, userId));

  const roomIds = myRooms.map(r => r.roomId);
  if (roomIds.length === 0) { res.json({ rooms: [] }); return; }

  const rooms = await Promise.all(roomIds.map(async (roomId) => {
    const [room] = await db.select().from(dmRooms).where(eq(dmRooms.id, roomId)).limit(1);
    if (!room) return null;
    const members = await db.select().from(dmRoomMembers).where(eq(dmRoomMembers.roomId, roomId));
    const [lastMsg] = await db.select().from(dmMessages)
      .where(eq(dmMessages.roomId, roomId))
      .orderBy(desc(dmMessages.createdAt)).limit(1);
    const unread = await db.select({ cnt: sql<number>`count(*)::int` })
      .from(dmMessages)
      .where(and(eq(dmMessages.roomId, roomId), eq(dmMessages.isRead, false)));
    return { ...room, members, lastMessage: lastMsg ?? null, unreadCount: unread[0]?.cnt ?? 0 };
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
    const [target] = await db.select().from(usersTable).where(eq(usersTable.username, targetUsername)).limit(1);
    if (!target) { res.status(404).json({ error: "Citizen not found" }); return; }

    // Check if DM already exists
    const myDMs = await db.select({ roomId: dmRoomMembers.roomId })
      .from(dmRoomMembers).where(and(eq(dmRoomMembers.userId, userId)));
    for (const { roomId } of myDMs) {
      const members = await db.select().from(dmRoomMembers).where(eq(dmRoomMembers.roomId, roomId));
      if (members.length === 2 && members.some(m => m.userId === target.id)) {
        const [room] = await db.select().from(dmRooms).where(eq(dmRooms.id, roomId)).limit(1);
        res.json({ room }); return;
      }
    }

    // Create new DM room
    const [room] = await db.insert(dmRooms).values({ type: "direct", createdBy: userId }).returning();
    await db.insert(dmRoomMembers).values([
      { roomId: room.id, userId: me.id,     username: me.username },
      { roomId: room.id, userId: target.id, username: target.username },
    ]);
    res.status(201).json({ room });
  } else {
    // Group room
    const [room] = await db.insert(dmRooms).values({
      type: "group", name: roomName ?? "Group Room", icon, createdBy: userId,
    }).returning();
    await db.insert(dmRoomMembers).values({ roomId: room.id, userId: me.id, username: me.username });
    res.status(201).json({ room });
  }
});

// ── POST /messages/rooms/:id/join — join a group room ─────────────────────────
router.post("/messages/rooms/:id/join", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = parseInt(req.params.id);
  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }
  const [exists] = await db.select().from(dmRoomMembers)
    .where(and(eq(dmRoomMembers.roomId, roomId), eq(dmRoomMembers.userId, userId))).limit(1);
  if (!exists) {
    await db.insert(dmRoomMembers).values({ roomId, userId, username: me.username });
  }
  res.json({ ok: true });
});

// ── GET /messages/rooms/:id — get messages ────────────────────────────────────
router.get("/messages/rooms/:id", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = parseInt(req.params.id);

  const msgs = await db.select().from(dmMessages)
    .where(eq(dmMessages.roomId, roomId))
    .orderBy(desc(dmMessages.createdAt)).limit(60);

  const members = await db.select().from(dmRoomMembers).where(eq(dmRoomMembers.roomId, roomId));
  const [room] = await db.select().from(dmRooms).where(eq(dmRooms.id, roomId)).limit(1);

  // Mark as read
  await db.update(dmMessages).set({ isRead: true })
    .where(and(eq(dmMessages.roomId, roomId), eq(dmMessages.isRead, false)));

  res.json({ room, messages: msgs.reverse(), members });
});

// ── POST /messages/rooms/:id/send ─────────────────────────────────────────────
router.post("/messages/rooms/:id/send", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = parseInt(req.params.id);

  const { content, audioUrl, videoUrl, type = "text" } = req.body as {
    content?: string; audioUrl?: string; videoUrl?: string; type?: string;
  };

  if (!content?.trim() && !audioUrl && !videoUrl) {
    res.status(400).json({ error: "Message content required" }); return;
  }

  if (content) {
    const check = await validateContent(content, { allowTrivial: false });
    if (!check.ok) { res.status(400).json({ error: check.reason }); return; }
  }

  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const [msg] = await db.insert(dmMessages).values({
    roomId, userId, username: me.username,
    content: content?.trim() ?? null,
    audioUrl: audioUrl ?? null, videoUrl: videoUrl ?? null, type,
  }).returning();

  res.status(201).json({ message: msg });
});

// ── GET /messages/unread-count ────────────────────────────────────────────────
router.get("/messages/unread-count", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.json({ count: 0 }); return; }

  const myRooms = await db.select({ roomId: dmRoomMembers.roomId })
    .from(dmRoomMembers).where(eq(dmRoomMembers.userId, userId));
  const roomIds = myRooms.map(r => r.roomId);

  let count = 0;
  for (const roomId of roomIds) {
    const [r] = await db.select({ cnt: sql<number>`count(*)::int` })
      .from(dmMessages)
      .where(and(eq(dmMessages.roomId, roomId), eq(dmMessages.isRead, false)));
    count += r?.cnt ?? 0;
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
