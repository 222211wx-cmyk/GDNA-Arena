import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const dmRooms = pgTable("dm_rooms", {
  id: serial("id").primaryKey(),
  name: text("name"),                      // null for 1-on-1 DMs
  type: text("type").notNull().default("direct"), // direct | group
  icon: text("icon").default("👥"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const dmRoomMembers = pgTable("dm_room_members", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull(),
  userId: integer("user_id").notNull(),
  username: text("username").notNull(),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
});

export const dmMessages = pgTable("dm_messages", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull(),
  userId: integer("user_id"),
  username: text("username").notNull().default("Anonymous"),
  content: text("content"),               // null for audio/video messages
  audioUrl: text("audio_url"),            // YouTube/SoundCloud URL
  videoUrl: text("video_url"),
  type: text("type").notNull().default("text"), // text | audio | video
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
