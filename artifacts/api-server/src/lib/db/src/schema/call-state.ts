import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** PostgreSQL authority for direct and group call documents. */
export const callStateDocuments = pgTable("call_state_documents", {
  path: text("path").primaryKey(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});