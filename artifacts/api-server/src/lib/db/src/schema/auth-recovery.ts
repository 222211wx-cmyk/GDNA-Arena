import { sql } from "drizzle-orm";
import { bigint, check, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/** Optional SMS recovery; never a replacement for the citizen's local login. */
export const recoveryPhonesTable = pgTable("auth_recovery_phones", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  phoneE164: text("phone_e164").notNull(),
  firebaseProjectId: text("firebase_project_id").notNull(),
  verifiedAuthTime: bigint("verified_auth_time", { mode: "number" }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  phoneUnique: uniqueIndex("auth_recovery_phones_phone_unique").on(table.phoneE164),
  canonicalPhone: check("auth_recovery_phones_e164", sql`${table.phoneE164} ~ '^\\+[1-9][0-9]{1,14}$'`),
}));

/** Global event tombstones deliberately survive account erasure and unbinding.
 * Only a digest of project/sub/auth_time is retained, never a JWT or phone.
 * Do not cascade or purge these when clearing an account's phone mapping. */
export const recoveryProofsTable = pgTable("auth_recovery_proofs", {
  eventDigest: text("event_digest").primaryKey(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  digestFormat: check("auth_recovery_proofs_digest", sql`${table.eventDigest} ~ '^[0-9a-f]{64}$'`),
}));

/** Shared, durable recovery-only counters; subject keys are one-way digests. */
export const recoveryRateLimitsTable = pgTable("auth_recovery_rate_limits", {
  scopeDigest: text("scope_digest").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(1),
}, table => ({
  pk: primaryKey({ columns: [table.scopeDigest, table.windowStart] }),
  positiveAttempts: check("auth_recovery_rate_limits_attempts", sql`${table.attempts} > 0`),
}));

export const insertRecoveryPhoneSchema = createInsertSchema(recoveryPhonesTable).omit({ verifiedAt: true });
export const insertRecoveryProofSchema = createInsertSchema(recoveryProofsTable).omit({ consumedAt: true });
export const insertRecoveryRateLimitSchema = createInsertSchema(recoveryRateLimitsTable);
export type InsertRecoveryPhone = z.infer<typeof insertRecoveryPhoneSchema>;
export type RecoveryPhone = typeof recoveryPhonesTable.$inferSelect;
export type InsertRecoveryProof = z.infer<typeof insertRecoveryProofSchema>;
export type RecoveryProof = typeof recoveryProofsTable.$inferSelect;
export type InsertRecoveryRateLimit = z.infer<typeof insertRecoveryRateLimitSchema>;
export type RecoveryRateLimit = typeof recoveryRateLimitsTable.$inferSelect;