import { bigint, bigserial, integer, pgTable, text, timestamp, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const nativeCallPushInstallations = pgTable("native_call_push_installations", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sessionHash: text("session_hash").notNull(),
  installationId: text("installation_id").notNull(),
  provider: text("provider").notNull(),
  token: text("token").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  installationUnique: uniqueIndex("native_call_push_installation_unique").on(table.installationId),
  tokenUnique: uniqueIndex("native_call_push_token_unique").on(table.provider, table.token),
}));

export const nativeCallPushDeliveries = pgTable("native_call_push_deliveries", {
  installationId: bigint("installation_id", { mode: "number" }).notNull()
    .references(() => nativeCallPushInstallations.id, { onDelete: "cascade" }),
  eventKey: text("event_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  pk: primaryKey({ columns: [table.installationId, table.eventKey] }),
}));