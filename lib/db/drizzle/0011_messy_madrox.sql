ALTER TABLE "payment_allocations" ADD COLUMN "refunded_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_receipts" ADD COLUMN "status" text DEFAULT 'processing' NOT NULL;