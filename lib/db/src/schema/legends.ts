import { sql } from "drizzle-orm";
import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const legendsTable = pgTable("legends", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  nationality: text("nationality").notNull().default(""),
  rank: integer("rank").notNull().default(1),
  score: integer("score").notNull().default(0),
  imageUrl: text("image_url"),
  peakYear: integer("peak_year"),
  bio: jsonb("bio"),
  videos: jsonb("videos").default(sql`'[]'::jsonb`),
  stats: jsonb("stats"),
  isActive: boolean("is_active").notNull().default(true),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const legendDebatesTable = pgTable("legend_debates", {
  id: serial("id").primaryKey(),
  legendId: integer("legend_id").notNull(),
  userId: integer("user_id"),
  username: text("username").notNull().default("Anonymous"),
  message: text("message").notNull(),
  likes: integer("likes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const legendWatchesTable = pgTable("legend_watches", {
  id: serial("id").primaryKey(),
  legendId: integer("legend_id").notNull(),
  userId: integer("user_id"),
  voterIp: text("voter_ip").notNull(),
  videoId: text("video_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Stories (24h expiry)
export const legendStoriesTable = pgTable("legend_stories", {
  id: serial("id").primaryKey(),
  legendId: integer("legend_id").notNull(),
  userId: integer("user_id"),
  username: text("username").notNull().default("Anonymous"),
  content: text("content").notNull(),
  mediaUrl: text("media_url"),          // optional YouTube/image URL
  type: text("type").notNull().default("text"), // text | audio | image
  likes: integer("likes").notNull().default(0),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Global arena events per legend (calendar)
export const legendArenaEventsTable = pgTable("legend_arena_events", {
  id: serial("id").primaryKey(),
  legendId: integer("legend_id"),         // null = all domains
  domain: text("domain").notNull(),
  title: text("title").notNull(),
  speaker: text("speaker"),
  eventType: text("event_type").notNull().default("lecture"), // lecture|debate|conference|summit
  youtubeId: text("youtube_id"),          // embed if available
  externalUrl: text("external_url"),
  eventDate: text("event_date").notNull(),
  isLive: boolean("is_live").notNull().default(false),
  notifiedLive: boolean("notified_live").notNull().default(false),
  icon: text("icon").notNull().default("🎓"),
  coinsReward: integer("coins_reward").notNull().default(50),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
