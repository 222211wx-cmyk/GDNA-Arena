CREATE TABLE "browser_push_deliveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"call_id" text NOT NULL,
	"notification_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "browser_push_subscriptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_hash" text NOT NULL,
	"installation_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"encrypted_keys" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "browser_push_vapid_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "browser_push_subscriptions" ADD CONSTRAINT "browser_push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "browser_push_deliveries_dedupe_uniq" ON "browser_push_deliveries" USING btree ("subscription_id","call_id","notification_type");--> statement-breakpoint
CREATE UNIQUE INDEX "browser_push_subscriptions_endpoint_uniq" ON "browser_push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE UNIQUE INDEX "browser_push_subscriptions_installation_uniq" ON "browser_push_subscriptions" USING btree ("user_id","session_hash","installation_id");