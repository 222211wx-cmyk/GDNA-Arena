-- Additive development schema only. Replit Publish owns production application.
-- No changes to users/passwords or the retired password_reset_codes table.
CREATE TABLE "auth_recovery_phones" (
  "user_id" integer PRIMARY KEY NOT NULL,
  "phone_e164" text NOT NULL,
  "firebase_project_id" text NOT NULL,
  "verified_auth_time" bigint NOT NULL,
  "verified_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "auth_recovery_phones_e164" CHECK ("phone_e164" ~ '^\+[1-9][0-9]{1,14}$'),
  CONSTRAINT "auth_recovery_phones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_recovery_phones_phone_unique" ON "auth_recovery_phones" ("phone_e164");
--> statement-breakpoint
CREATE TABLE "auth_recovery_proofs" (
  "event_digest" text PRIMARY KEY NOT NULL,
  "consumed_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "auth_recovery_proofs_digest" CHECK ("event_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "auth_recovery_rate_limits" (
  "scope_digest" text NOT NULL,
  "window_start" timestamptz NOT NULL,
  "attempts" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "auth_recovery_rate_limits_scope_digest_window_start_pk" PRIMARY KEY ("scope_digest", "window_start"),
  CONSTRAINT "auth_recovery_rate_limits_attempts" CHECK ("attempts" > 0)
);