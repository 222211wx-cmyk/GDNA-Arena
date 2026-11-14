import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const offlineRecoveryCodesTable = pgTable("auth_offline_recovery_codes", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  codeDigest: text("code_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => ({
  digestUnique: uniqueIndex("auth_offline_recovery_digest_unique").on(t.codeDigest),
  digestFormat: check("auth_offline_recovery_digest_format", sql`${t.codeDigest} ~ '^[0-9a-f]{64}$'`),
}));

// No code, password, username, IP or session cookie belongs in this audit trail.
export const offlineRecoveryAuditTable = pgTable("auth_offline_recovery_audit", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const offlineRecoveryLimitsTable = pgTable("auth_offline_recovery_limits", {
  scopeDigest: text("scope_digest").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(1),
}, t => ({ pk: primaryKey({ columns: [t.scopeDigest, t.windowStart] }) }));

// A provider outage must not silently lose external mirror revocation.
export const offlineRecoveryRevocationsTable = pgTable("auth_offline_recovery_revocations", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  credentialEpoch: integer("credential_epoch").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOfflineRecoveryCodeSchema = createInsertSchema(offlineRecoveryCodesTable).omit({ createdAt: true });
export const insertOfflineRecoveryAuditSchema = createInsertSchema(offlineRecoveryAuditTable).omit({ id: true, createdAt: true });
export const insertOfflineRecoveryLimitSchema = createInsertSchema(offlineRecoveryLimitsTable);
export const insertOfflineRecoveryRevocationSchema = createInsertSchema(offlineRecoveryRevocationsTable).omit({ createdAt: true });
export type InsertOfflineRecoveryCode = z.infer<typeof insertOfflineRecoveryCodeSchema>;
export type OfflineRecoveryCode = typeof offlineRecoveryCodesTable.$inferSelect;
export type InsertOfflineRecoveryAudit = z.infer<typeof insertOfflineRecoveryAuditSchema>;
export type OfflineRecoveryAudit = typeof offlineRecoveryAuditTable.$inferSelect;
export type InsertOfflineRecoveryLimit = z.infer<typeof insertOfflineRecoveryLimitSchema>;
export type OfflineRecoveryLimit = typeof offlineRecoveryLimitsTable.$inferSelect;
export type InsertOfflineRecoveryRevocation = z.infer<typeof insertOfflineRecoveryRevocationSchema>;
export type OfflineRecoveryRevocation = typeof offlineRecoveryRevocationsTable.$inferSelect;