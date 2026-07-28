import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const gsFiguresTable = pgTable("gs_figures", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  nationality: text("nationality").notNull().default(""),
  imageUrl: text("image_url"),
  votes: integer("votes").notNull().default(0),
  bio: text("bio").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const gsVotesTable = pgTable("gs_votes", {
  id: serial("id").primaryKey(),
  figureId: integer("figure_id").notNull(),
  voterIp: text("voter_ip").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const gsNewsTable = pgTable("gs_news", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  domain: text("domain").notNull(),
  source: text("source").notNull(),
  publishedAt: timestamp("published_at").notNull().defaultNow(),
  imageUrl: text("image_url"),
  isBreaking: boolean("is_breaking").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const gsTraditionsTable = pgTable("gs_traditions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  country: text("country").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  period: text("period").notNull(),
  isArchaeological: boolean("is_archaeological").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Media: stories / videos / audio attached to figures ──────────────────────
export const gsMediaTable = pgTable("gs_media", {
  id: serial("id").primaryKey(),
  figureId: integer("figure_id").notNull(),
  domain: text("domain").notNull(),
  type: text("type").notNull(),          // 'story' | 'video' | 'audio'
  title: text("title").notNull(),
  content: text("content").notNull().default(""),  // story text OR embed URL/ID
  thumbnailUrl: text("thumbnail_url"),
  durationSec: integer("duration_sec"),
  platform: text("platform"),            // 'youtube' | 'soundcloud' | 'internal'
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
