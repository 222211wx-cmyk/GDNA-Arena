import { bigserial, foreignKey, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dmRooms } from "./messages";
import { usersTable } from "./users";

export const messageSafetyReportsTable = pgTable("dm_safety_reports", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  roomId: integer("room_id").notNull(),
  reporterId: integer("reporter_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique("dm_safety_reports_room_id_reporter_id_key").on(table.roomId, table.reporterId),
  foreignKey({ name: "dm_safety_reports_room_id_fkey", columns: [table.roomId], foreignColumns: [dmRooms.id] }).onDelete("cascade"),
  foreignKey({ name: "dm_safety_reports_reporter_id_fkey", columns: [table.reporterId], foreignColumns: [usersTable.id] }).onDelete("cascade"),
]);

export const insertMessageSafetyReportSchema = createInsertSchema(messageSafetyReportsTable)
  .omit({ id: true, createdAt: true });
export type InsertMessageSafetyReport = z.infer<typeof insertMessageSafetyReportSchema>;
export type MessageSafetyReport = typeof messageSafetyReportsTable.$inferSelect;