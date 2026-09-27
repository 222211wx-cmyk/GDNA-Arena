import { sql } from "drizzle-orm";
import { pgTable, text, serial, integer, timestamp, boolean, date, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  birthDate: date("birth_date"),
  balance: integer("balance").notNull().default(500),
  xp: integer("xp").notNull().default(0),
  gamesPlayed: integer("games_played").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  lastDailyReward: timestamp("last_daily_reward", { withTimezone: true }),
  lastDmXpAt: timestamp("last_dm_xp_at", { withTimezone: true }), // DM XP cooldown cursor
  isAdmin: boolean("is_admin").notNull().default(false),
  hasActiveSubscription: boolean("has_active_subscription").notNull().default(false),
  freeMessagesUsed: integer("free_messages_used").notNull().default(0),
  honorCount: integer("honor_count").notNull().default(0),
  isMuted: boolean("is_muted").notNull().default(false),
  honorTitle: text("honor_title").notNull().default("Citizen"),
  isTrending: boolean("is_trending").notNull().default(false),
  honorAlertSent: boolean("honor_alert_sent").notNull().default(false),
  welcomeBroadcastSent: boolean("welcome_broadcast_sent").default(false),
  imperialDecreeSent: boolean("imperial_decree_sent").default(false),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
  isStar: boolean("is_star").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailLowerUnique: uniqueIndex("users_email_lower_uniq").on(sql`lower(${t.email})`),
  usernameLowerUnique: uniqueIndex("users_username_lower_uniq").on(sql`lower(${t.username})`),
}));

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

// Append-only administrator decisions; no billing provider or automatic grants.
export const messagingSubscriptionAudit = pgTable("messaging_subscription_audit", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id").notNull(),
  citizenId: integer("citizen_id").notNull(),
  previousActive: boolean("previous_active").notNull(),
  active: boolean("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
