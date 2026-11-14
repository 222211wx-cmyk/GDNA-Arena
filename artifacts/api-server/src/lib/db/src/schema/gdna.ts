import { pgTable, text, integer, uuid, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const gdnaUsageTable = pgTable("gdna_usage", {
  day: text("day").notNull(),
  scope: text("scope").notNull(),
  used: integer("used").notNull().default(0),
}, t => [primaryKey({ columns: [t.day, t.scope] })]);
export const gdnaMemoryTable = pgTable("gdna_memory", {
  id: uuid("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const gdnaAuditTable = pgTable("gdna_audit", {
  id: uuid("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  agent: text("agent").notNull(),
  mode: text("mode").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const gdnaEvolutionTable = pgTable("gdna_evolution", {
  id: text("id").primaryKey(),
  agent: text("agent").notNull(),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});