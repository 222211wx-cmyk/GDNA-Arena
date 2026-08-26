CREATE TABLE "admin_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" integer NOT NULL,
	"action" text NOT NULL,
	"target_ref" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beneficiaries" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"entity_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stripe_account_id" text,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beneficiaries_stripe_account_id_unique" UNIQUE("stripe_account_id")
);
--> statement-breakpoint
CREATE TABLE "finance_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"user_id" integer,
	"display_name" text NOT NULL,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"user_id" integer NOT NULL,
	"payment_ref" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"tax_country" text,
	"tax_status" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"journal_id" text NOT NULL,
	"wallet_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journals" (
	"id" text PRIMARY KEY NOT NULL,
	"source_ref" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"kind" text NOT NULL,
	"reversal_of_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_ref" text NOT NULL,
	"beneficiary_id" text,
	"policy_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"beneficiary_id" text NOT NULL,
	"wallet_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"idempotency_key" text NOT NULL,
	"stripe_payout_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_requests_stripe_payout_id_unique" UNIQUE("stripe_payout_id")
);
--> statement-breakpoint
CREATE TABLE "provider_cost_records" (
	"id" text PRIMARY KEY NOT NULL,
	"usage_record_id" text,
	"cost_center_entity_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"estimated" boolean DEFAULT true NOT NULL,
	"rate_card_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"metric" text NOT NULL,
	"quantity" bigint NOT NULL,
	"unit" text NOT NULL,
	"source_ref" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"metric" text NOT NULL,
	"version" integer NOT NULL,
	"unit" text NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"source_ref" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "split_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"platform_bps" integer DEFAULT 3000 NOT NULL,
	"beneficiary_bps" integer DEFAULT 7000 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_references" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"stripe_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms_acceptances" (
	"id" text PRIMARY KEY NOT NULL,
	"beneficiary_id" text NOT NULL,
	"terms_version" text NOT NULL,
	"accepted_by_user_id" integer NOT NULL,
	"ip_hash" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"asset" text NOT NULL,
	"currency" text NOT NULL,
	"available_minor" bigint DEFAULT 0 NOT NULL,
	"reserved_minor" bigint DEFAULT 0 NOT NULL,
	"pending_minor" bigint DEFAULT 0 NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"income_minor" bigint DEFAULT 0 NOT NULL,
	"expense_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"stripe_event_id" text NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_entity_id_finance_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."finance_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entities" ADD CONSTRAINT "finance_entities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_reversal_of_id_journals_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_policy_id_split_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."split_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_cost_records" ADD CONSTRAINT "provider_cost_records_usage_record_id_provider_usage_records_id_fk" FOREIGN KEY ("usage_record_id") REFERENCES "public"."provider_usage_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_cost_records" ADD CONSTRAINT "provider_cost_records_cost_center_entity_id_finance_entities_id_fk" FOREIGN KEY ("cost_center_entity_id") REFERENCES "public"."finance_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_entity_id_finance_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."finance_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_entities_kind_idx" ON "finance_entities" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_reference_uniq" ON "invoices" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_payment_ref_uniq" ON "invoices" USING btree ("payment_ref");--> statement-breakpoint
CREATE INDEX "journal_entries_journal_idx" ON "journal_entries" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "journal_entries_wallet_idx" ON "journal_entries" USING btree ("wallet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journals_idempotency_key_uniq" ON "journals" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "journals_source_ref_uniq" ON "journals" USING btree ("source_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocations_ref_beneficiary_uniq" ON "payment_allocations" USING btree ("payment_ref","beneficiary_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_requests_idempotency_uniq" ON "payout_requests" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_usage_source_ref_uniq" ON "provider_usage_records" USING btree ("source_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_cards_provider_metric_version_uniq" ON "rate_cards" USING btree ("provider","metric","version");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_issues_kind_ref_uniq" ON "reconciliation_issues" USING btree ("kind","source_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "split_policies_version_uniq" ON "split_policies" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_references_entity_kind_uniq" ON "stripe_references" USING btree ("entity_type","entity_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_references_stripe_kind_uniq" ON "stripe_references" USING btree ("stripe_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "terms_acceptances_beneficiary_version_uniq" ON "terms_acceptances" USING btree ("beneficiary_id","terms_version");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_entity_asset_currency_uniq" ON "wallets" USING btree ("entity_id","asset","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_receipts_event_uniq" ON "webhook_receipts" USING btree ("stripe_event_id");