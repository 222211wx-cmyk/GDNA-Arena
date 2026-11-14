CREATE TABLE IF NOT EXISTS "users" (
  "id" serial PRIMARY KEY,
  "username" text NOT NULL UNIQUE,
  "email" text NOT NULL UNIQUE,
  "password_hash" text NOT NULL,
  "credential_epoch" integer NOT NULL DEFAULT 0,
  "birth_date" date,
  "balance" integer NOT NULL DEFAULT 500,
  "xp" integer NOT NULL DEFAULT 0,
  "games_played" integer NOT NULL DEFAULT 0,
  "wins" integer NOT NULL DEFAULT 0,
  "last_daily_reward" timestamptz,
  "last_dm_xp_at" timestamptz,
  "is_admin" boolean NOT NULL DEFAULT false,
  "has_active_subscription" boolean NOT NULL DEFAULT false,
  "free_messages_used" integer NOT NULL DEFAULT 0,
  "honor_count" integer NOT NULL DEFAULT 0,
  "is_muted" boolean NOT NULL DEFAULT false,
  "honor_title" text NOT NULL DEFAULT 'Citizen',
  "is_trending" boolean NOT NULL DEFAULT false,
  "honor_alert_sent" boolean NOT NULL DEFAULT false,
  "welcome_broadcast_sent" boolean DEFAULT false,
  "imperial_decree_sent" boolean DEFAULT false,
  "last_seen_at" timestamp DEFAULT now(),
  "is_star" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "users_free_messages_used_range" CHECK ("free_messages_used" BETWEEN 0 AND 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_uniq" ON "users" (lower("email"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_lower_uniq" ON "users" (lower("username"));
