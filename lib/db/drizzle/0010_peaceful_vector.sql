CREATE TABLE "beneficiary_payout_details" (
	"id" text PRIMARY KEY NOT NULL,
	"beneficiary_id" text NOT NULL,
	"encrypted_payload" text NOT NULL,
	"masked_account" text NOT NULL,
	"updated_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_payout_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"beneficiary_id" text NOT NULL,
	"payout_details_id" text NOT NULL,
	"period" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"provider" text DEFAULT 'redotpay_manual' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" integer NOT NULL,
	"reviewed_by_user_id" integer,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beneficiary_payout_details" ADD CONSTRAINT "beneficiary_payout_details_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiary_payout_details" ADD CONSTRAINT "beneficiary_payout_details_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_payout_requests" ADD CONSTRAINT "manual_payout_requests_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_payout_requests" ADD CONSTRAINT "manual_payout_requests_payout_details_id_beneficiary_payout_details_id_fk" FOREIGN KEY ("payout_details_id") REFERENCES "public"."beneficiary_payout_details"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_payout_requests" ADD CONSTRAINT "manual_payout_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_payout_requests" ADD CONSTRAINT "manual_payout_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "beneficiary_payout_details_beneficiary_uniq" ON "beneficiary_payout_details" USING btree ("beneficiary_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_payout_beneficiary_period_currency_uniq" ON "manual_payout_requests" USING btree ("beneficiary_id","period","currency");