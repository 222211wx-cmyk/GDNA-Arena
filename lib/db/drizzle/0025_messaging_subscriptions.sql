-- Feature-only additive migration. Publish owns production schema application;
-- never replay the application migration journal during API startup.
ALTER TABLE "users" ADD COLUMN "has_active_subscription" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "messaging_subscription_audit" (
  "id" serial PRIMARY KEY NOT NULL,
  "actor_id" integer NOT NULL,
  "citizen_id" integer NOT NULL,
  "previous_active" boolean NOT NULL,
  "active" boolean NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);