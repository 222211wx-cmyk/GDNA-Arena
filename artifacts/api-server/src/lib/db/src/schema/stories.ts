import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const platformStories = pgTable("platform_stories", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  username: text("username").notNull().default("Anonymous"),
  content: text("content").notNull(),
  audioUrl: text("audio_url"),    // YouTube/SoundCloud embed
  imageUrl: text("image_url"),
  type: text("type").notNull().default("text"), // text|audio|video
  domain: text("domain").notNull().default("general"),
  likes: integer("likes").notNull().default(0),
  isVisible: boolean("is_visible").notNull().default(true),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const storyLikes = pgTable("story_likes", {
  id: serial("id").primaryKey(),
  storyId: integer("story_id").notNull(),
  voterIp: text("voter_ip").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
