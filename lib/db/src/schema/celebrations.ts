import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const celebrations = pgTable("celebrations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  titleAr: text("title_ar"),
  category: text("category").notNull(),   // sport | holiday | science | art | music | global
  description: text("description").notNull(),
  date: text("date").notNull(),           // ISO date string
  endDate: text("end_date"),
  icon: text("icon").notNull().default("🎉"),
  color: text("color").notNull().default("#22c55e"),
  isLive: boolean("is_live").notNull().default(false),
  coinsReward: integer("coins_reward").notNull().default(50),
  topContributorCoins: integer("top_contributor_coins").notNull().default(500),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const celebrationEntries = pgTable("celebration_entries", {
  id: serial("id").primaryKey(),
  celebrationId: integer("celebration_id").notNull(),
  userId: integer("user_id"),
  username: text("username").notNull().default("Anonymous"),
  content: text("content").notNull(),
  mediaUrl: text("media_url"),
  entryType: text("entry_type").notNull().default("text"), // text | art | video | idea
  likes: integer("likes").notNull().default(0),
  isWinner: boolean("is_winner").notNull().default(false),
  hasImperialLaurel: boolean("has_imperial_laurel").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const celebrationLikes = pgTable("celebration_likes", {
  id: serial("id").primaryKey(),
  entryId: integer("entry_id").notNull(),
  voterIp: text("voter_ip").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
