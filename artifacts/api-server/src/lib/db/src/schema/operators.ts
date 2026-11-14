import { pgTable, text, integer, bigint, uuid, timestamp, primaryKey, index, serial, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const operatorEventsTable = pgTable("operator_events", {
  day: text("day").notNull(), sessionHash: text("session_hash").notNull(),
  kind: text("kind").notNull(), eventId: uuid("event_id").notNull(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  surface: text("surface"), outcome: text("outcome"),
  observedBytes: bigint("observed_bytes", { mode: "number" }).notNull().default(0),
  avoidedBytes: bigint("avoided_bytes", { mode: "number" }).notNull().default(0),
  comparison: boolean("comparison").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.day, t.sessionHash, t.kind, t.eventId] }), index("operator_events_user_day_idx").on(t.userId, t.day)]);
export const operatorAttributionsTable = pgTable("operator_attributions", {
  sessionHash: text("session_hash").primaryKey(), source: text("source").notNull(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const operatorQuotasTable = pgTable("operator_quotas", {
  day: text("day").notNull(), scope: text("scope").notNull(), kind: text("kind").notNull(),
  used: integer("used").notNull().default(0),
}, t => [primaryKey({ columns: [t.day, t.scope, t.kind] })]);
export const partnerContactsTable = pgTable("partner_contacts", {
  id: serial("id").primaryKey(), company: text("company").notNull(),
  contactEmail: text("contact_email").notNull(), message: text("message").notNull(),
  consent: boolean("consent").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const operatorAudioReceiptsTable = pgTable("operator_audio_receipts", {
  id: uuid("id").primaryKey(), sessionHash: text("session_hash").notNull(),
  clipId: integer("clip_id").notNull(),
  originalBytes: bigint("original_bytes", { mode: "number" }).notNull(),
  alternativeBytes: bigint("alternative_bytes", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("operator_audio_receipts_session_clip_idx").on(t.sessionHash, t.clipId)]);