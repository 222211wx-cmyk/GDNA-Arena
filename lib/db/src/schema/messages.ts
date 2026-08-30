import { pgTable, serial, text, integer, boolean, timestamp, numeric, uniqueIndex, jsonb, primaryKey } from "drizzle-orm/pg-core";

export const dmRooms = pgTable("dm_rooms", {
  id: serial("id").primaryKey(),
  name: text("name"),                      // null for 1-on-1 DMs
  type: text("type").notNull().default("direct"), // direct | group
  icon: text("icon").default("💬"),
  createdBy: integer("created_by"),
  revenue: numeric("revenue", { precision: 14, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const dmRoomMembers = pgTable("dm_room_members", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull(),
  userId: integer("user_id").notNull(),
  username: text("username").notNull(),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  // Per-member read cursor: messages created after this timestamp are "unread" for this member
  lastReadAt: timestamp("last_read_at"),
  muted: boolean("muted").notNull().default(false),
});

export const dmMessages = pgTable("dm_messages", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull(),
  userId: integer("user_id"),
  username: text("username").notNull().default("Anonymous"),
  content: text("content"),               // null for audio/video messages
  audioUrl: text("audio_url"),            // YouTube/SoundCloud URL
  videoUrl: text("video_url"),
  fileUrl: text("file_url"),               // image/file attachment URL
  type: text("type").notNull().default("text"), // text | audio | video | image | file
  isRead: boolean("is_read").notNull().default(false),
  replyToId: integer("reply_to_id"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const dmMessageReactions = pgTable("dm_message_reactions", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull(),
  userId: integer("user_id").notNull(),
  reaction: text("reaction").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ oneReactionPerUser: uniqueIndex("dm_message_reactions_user_message").on(t.messageId, t.userId) }));

export const dmUserE2eeKeys = pgTable("dm_user_e2ee_keys", {
  userId: integer("user_id").notNull(),
  deviceId: text("device_id").notNull(),
  publicKey: jsonb("public_key").$type<Record<string, unknown>>().notNull(),
  fingerprint: text("fingerprint").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userDevicePrimaryKey: primaryKey({ columns: [t.userId, t.deviceId] }),
  userFingerprintUnique: uniqueIndex("dm_user_e2ee_keys_user_fingerprint").on(t.userId, t.fingerprint),
}));
