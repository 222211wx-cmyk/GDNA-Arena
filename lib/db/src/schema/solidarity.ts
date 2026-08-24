import { pgTable, serial, integer, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const solidarityInitiatives = pgTable("solidarity_initiatives", {
  id: serial("id").primaryKey(),
  creatorId: integer("creator_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  domain: text("domain").notNull(),
  roomId: integer("room_id"),
  targetSupport: integer("target_support").notNull(),
  status: text("status").notNull().default("open"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const solidaritySupports = pgTable("solidarity_supports", {
  id: serial("id").primaryKey(),
  initiativeId: integer("initiative_id").notNull(),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ uniqueSupport: uniqueIndex("solidarity_supports_unique").on(t.initiativeId, t.userId) }));

export const solidarityProfiles = pgTable("citizen_solidarity_profiles", {
  userId: integer("user_id").primaryKey(),
  score: integer("score").notNull().default(0),
  initiativesCompleted: integer("initiatives_completed").notNull().default(0),
  supportsCompleted: integer("supports_completed").notNull().default(0),
  status: text("status").notNull().default("available"),
  statusVisible: boolean("status_visible").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const citizenBlocks = pgTable("citizen_blocks", {
  id: serial("id").primaryKey(),
  blockerId: integer("blocker_id").notNull(),
  blockedId: integer("blocked_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ uniqueBlock: uniqueIndex("citizen_blocks_unique").on(t.blockerId, t.blockedId) }));