-- Additive only. Apply to development through the normal schema workflow;
-- Replit Publish owns production schema application. Never run on startup.
ALTER TABLE "users" ADD COLUMN "credential_epoch" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE "auth_offline_recovery_codes" (
  "user_id" integer PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "code_digest" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "auth_offline_recovery_digest_format" CHECK ("code_digest" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "auth_offline_recovery_digest_unique" ON "auth_offline_recovery_codes" ("code_digest");
--> statement-breakpoint
CREATE TABLE "auth_offline_recovery_audit" (
  "id" serial PRIMARY KEY,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_offline_recovery_limits" (
  "scope_digest" text NOT NULL,
  "window_start" timestamptz NOT NULL,
  "attempts" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "auth_offline_recovery_limits_scope_digest_window_start_pk" PRIMARY KEY ("scope_digest", "window_start")
);
--> statement-breakpoint
CREATE TABLE "auth_offline_recovery_revocations" (
  "user_id" integer PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "credential_epoch" integer NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);