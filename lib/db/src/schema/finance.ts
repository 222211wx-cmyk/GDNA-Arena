import { sql } from "drizzle-orm";
import { pgTable, text, integer, bigint, boolean, timestamp, jsonb, uniqueIndex, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Financial records deliberately use no `onDelete: cascade`: journals are evidence.
const id = () => text("id").primaryKey();
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const currency = () => text("currency").notNull(); // application validates ISO-4217 lowercase

export const financeEntitiesTable = pgTable("finance_entities", {
  id: id(), kind: text("kind").notNull(), userId: integer("user_id").references(() => usersTable.id),
  displayName: text("display_name").notNull(), country: text("country"), createdAt: created(),
}, (t) => ({ kindIndex: index("finance_entities_kind_idx").on(t.kind) }));

export const walletsTable = pgTable("wallets", {
  id: id(), entityId: text("entity_id").notNull().references(() => financeEntitiesTable.id),
  asset: text("asset").notNull(), currency: currency(), availableMinor: bigint("available_minor", { mode: "number" }).notNull().default(0),
  reservedMinor: bigint("reserved_minor", { mode: "number" }).notNull().default(0),
  pendingMinor: bigint("pending_minor", { mode: "number" }).notNull().default(0),
  paidMinor: bigint("paid_minor", { mode: "number" }).notNull().default(0),
  incomeMinor: bigint("income_minor", { mode: "number" }).notNull().default(0),
  expenseMinor: bigint("expense_minor", { mode: "number" }).notNull().default(0), createdAt: created(),
}, (t) => ({ assetUnique: uniqueIndex("wallets_entity_asset_currency_uniq").on(t.entityId, t.asset, t.currency) }));

export const journalsTable = pgTable("journals", {
  id: id(), sourceRef: text("source_ref").notNull(), idempotencyKey: text("idempotency_key").notNull(),
  kind: text("kind").notNull(), reversalOfId: text("reversal_of_id").references((): AnyPgColumn => journalsTable.id),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`), createdAt: created(),
}, (t) => ({ idempotencyUnique: uniqueIndex("journals_idempotency_key_uniq").on(t.idempotencyKey), sourceUnique: uniqueIndex("journals_source_ref_uniq").on(t.sourceRef) }));

export const journalEntriesTable = pgTable("journal_entries", {
  id: id(), journalId: text("journal_id").notNull().references(() => journalsTable.id),
  walletId: text("wallet_id").notNull().references(() => walletsTable.id),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), currency: currency(),
  createdAt: created(),
}, (t) => ({ journalIndex: index("journal_entries_journal_idx").on(t.journalId), walletIndex: index("journal_entries_wallet_idx").on(t.walletId) }));

export const splitPoliciesTable = pgTable("split_policies", {
  id: id(), version: integer("version").notNull(), platformBps: integer("platform_bps").notNull().default(4000),
  beneficiaryBps: integer("beneficiary_bps").notNull().default(6000), active: boolean("active").notNull().default(true), createdAt: created(),
}, (t) => ({ versionUnique: uniqueIndex("split_policies_version_uniq").on(t.version) }));

export const beneficiariesTable = pgTable("beneficiaries", {
  id: id(), ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id),
  entityId: text("entity_id").notNull().references(() => financeEntitiesTable.id), type: text("type").notNull(),
  status: text("status").notNull().default("pending"), stripeAccountId: text("stripe_account_id").unique(),
  country: text("country"), createdAt: created(),
});
export const termsAcceptancesTable = pgTable("terms_acceptances", {
  id: id(), beneficiaryId: text("beneficiary_id").notNull().references(() => beneficiariesTable.id),
  termsVersion: text("terms_version").notNull(), acceptedByUserId: integer("accepted_by_user_id").notNull().references(() => usersTable.id),
  ipHash: text("ip_hash").notNull(), acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ acceptanceUnique: uniqueIndex("terms_acceptances_beneficiary_version_uniq").on(t.beneficiaryId, t.termsVersion) }));

export const stripeReferencesTable = pgTable("stripe_references", {
  id: id(), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(),
  stripeId: text("stripe_id").notNull(), kind: text("kind").notNull(), createdAt: created(),
}, (t) => ({ refUnique: uniqueIndex("stripe_references_entity_kind_uniq").on(t.entityType, t.entityId, t.kind), stripeUnique: uniqueIndex("stripe_references_stripe_kind_uniq").on(t.stripeId, t.kind) }));
export const paymentAllocationsTable = pgTable("payment_allocations", {
  id: id(), paymentRef: text("payment_ref").notNull(), beneficiaryId: text("beneficiary_id").references(() => beneficiariesTable.id),
  policyId: text("policy_id").notNull().references(() => splitPoliciesTable.id), amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: currency(), status: text("status").notNull().default("pending"),
  refundedMinor: bigint("refunded_minor", { mode: "number" }).notNull().default(0), createdAt: created(),
}, (t) => ({ paymentUnique: uniqueIndex("payment_allocations_ref_beneficiary_uniq").on(t.paymentRef, t.beneficiaryId) }));
export const payoutRequestsTable = pgTable("payout_requests", {
  id: id(), beneficiaryId: text("beneficiary_id").notNull().references(() => beneficiariesTable.id),
  walletId: text("wallet_id").notNull().references(() => walletsTable.id), amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: currency(), status: text("status").notNull().default("reserved"), idempotencyKey: text("idempotency_key").notNull(),
  stripePayoutId: text("stripe_payout_id").unique(), failureReason: text("failure_reason"), createdAt: created(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ idempotencyUnique: uniqueIndex("payout_requests_idempotency_uniq").on(t.idempotencyKey) }));

export const providerUsageRecordsTable = pgTable("provider_usage_records", {
  id: id(), provider: text("provider").notNull(), metric: text("metric").notNull(), quantity: bigint("quantity", { mode: "number" }).notNull(),
  unit: text("unit").notNull(), sourceRef: text("source_ref").notNull(), observedAt: timestamp("observed_at", { withTimezone: true }).notNull(), createdAt: created(),
}, (t) => ({ sourceUnique: uniqueIndex("provider_usage_source_ref_uniq").on(t.sourceRef) }));
export const rateCardsTable = pgTable("rate_cards", {
  id: id(), provider: text("provider").notNull(), metric: text("metric").notNull(), version: integer("version").notNull(),
  unit: text("unit").notNull(), unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
  currency: currency(), effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(), createdAt: created(),
}, (t) => ({ versionUnique: uniqueIndex("rate_cards_provider_metric_version_uniq").on(t.provider, t.metric, t.version) }));
export const providerCostRecordsTable = pgTable("provider_cost_records", {
  id: id(), usageRecordId: text("usage_record_id").references(() => providerUsageRecordsTable.id), costCenterEntityId: text("cost_center_entity_id").notNull().references(() => financeEntitiesTable.id),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), currency: currency(), estimated: boolean("estimated").notNull().default(true), rateCardVersion: integer("rate_card_version").notNull(), createdAt: created(),
});
export const invoicesTable = pgTable("invoices", {
  id: id(), reference: text("reference").notNull(), userId: integer("user_id").notNull().references(() => usersTable.id),
  paymentRef: text("payment_ref").notNull(), amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), currency: currency(),
  taxCountry: text("tax_country"), taxStatus: text("tax_status").notNull().default("unknown"), createdAt: created(),
}, (t) => ({ referenceUnique: uniqueIndex("invoices_reference_uniq").on(t.reference), paymentUnique: uniqueIndex("invoices_payment_ref_uniq").on(t.paymentRef) }));
export const webhookReceiptsTable = pgTable("webhook_receipts", {
  id: id(), stripeEventId: text("stripe_event_id").notNull(), type: text("type").notNull(), status: text("status").notNull().default("processing"), processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ eventUnique: uniqueIndex("webhook_receipts_event_uniq").on(t.stripeEventId) }));
export const reconciliationIssuesTable = pgTable("reconciliation_issues", {
  id: id(), kind: text("kind").notNull(), sourceRef: text("source_ref").notNull(), details: jsonb("details").notNull().default(sql`'{}'::jsonb`), status: text("status").notNull().default("open"), createdAt: created(), resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (t) => ({ sourceUnique: uniqueIndex("reconciliation_issues_kind_ref_uniq").on(t.kind, t.sourceRef) }));
export const adminAuditEventsTable = pgTable("admin_audit_events", {
  id: id(), adminUserId: integer("admin_user_id").notNull().references(() => usersTable.id), action: text("action").notNull(), targetRef: text("target_ref").notNull(), metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`), createdAt: created(),
});
export const beneficiaryPayoutDetailsTable = pgTable("beneficiary_payout_details", {
  id: id(), beneficiaryId: text("beneficiary_id").notNull().references(() => beneficiariesTable.id),
  encryptedPayload: text("encrypted_payload").notNull(), maskedAccount: text("masked_account").notNull(),
  updatedByUserId: integer("updated_by_user_id").notNull().references(() => usersTable.id),
  createdAt: created(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ beneficiaryUnique: uniqueIndex("beneficiary_payout_details_beneficiary_uniq").on(t.beneficiaryId) }));
export const manualPayoutRequestsTable = pgTable("manual_payout_requests", {
  id: id(), beneficiaryId: text("beneficiary_id").notNull().references(() => beneficiariesTable.id),
  payoutDetailsId: text("payout_details_id").notNull().references(() => beneficiaryPayoutDetailsTable.id),
  period: text("period").notNull(), amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  reservedMinor: bigint("reserved_minor", { mode: "number" }).notNull().default(0), reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(), currency: currency(),
  operationalVerified: boolean("operational_verified").notNull().default(false),
  provider: text("provider").notNull().default("redotpay_manual"), status: text("status").notNull().default("pending"),
  requestedByUserId: integer("requested_by_user_id").notNull().references(() => usersTable.id),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => usersTable.id), reviewNote: text("review_note"),
  createdAt: created(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ periodUnique: uniqueIndex("manual_payout_beneficiary_period_currency_uniq").on(t.beneficiaryId,t.period,t.currency) }));

export type Wallet = typeof walletsTable.$inferSelect;
export type Journal = typeof journalsTable.$inferSelect;
export const insertWalletSchema = createInsertSchema(walletsTable).omit({ createdAt: true });
export const insertJournalSchema = createInsertSchema(journalsTable).omit({ createdAt: true });
export const insertJournalEntrySchema = createInsertSchema(journalEntriesTable).omit({ createdAt: true });
export const insertBeneficiarySchema = createInsertSchema(beneficiariesTable).omit({ createdAt: true });
export const insertPayoutRequestSchema = createInsertSchema(payoutRequestsTable).omit({ createdAt: true, updatedAt: true });
export type InsertWallet = z.infer<typeof insertWalletSchema>;
export type InsertJournal = z.infer<typeof insertJournalSchema>;
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;
export type InsertBeneficiary = z.infer<typeof insertBeneficiarySchema>;