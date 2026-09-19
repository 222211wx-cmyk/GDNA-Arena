import { boolean, integer, jsonb, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const citizenProfilesTable = pgTable("citizen_profiles", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull().default(""),
  bio: text("bio").notNull().default(""),
  city: text("city"),
  interests: jsonb("interests").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("private"),
  visibility: text("visibility").notNull().default("everyone"),
  fieldVisibility: jsonb("field_visibility").$type<Record<string, string>>().notNull().default({}),
  avatarUrl: text("avatar_url"),
  coverUrl: text("cover_url"),
  mapDiscoverable: boolean("map_discoverable").notNull().default(false),
  aiConsent: boolean("ai_consent").notNull().default(false),
  views: integer("views").notNull().default(0),
});
export const citizenListingsTable = pgTable("citizen_listings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  city: text("city"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});