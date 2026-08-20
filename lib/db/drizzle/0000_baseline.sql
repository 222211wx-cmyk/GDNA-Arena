-- The database predates Drizzle migrations and its existing tables are created
-- by API startup SQL. This baseline records the current Drizzle snapshot while
-- idempotently repairing columns that older development databases may lack.

ALTER TABLE IF EXISTS "pulse_posts"
  ADD COLUMN IF NOT EXISTS "image_url" text;
--> statement-breakpoint
ALTER TABLE IF EXISTS "pulse_posts"
  ADD COLUMN IF NOT EXISTS "media_type" text;
--> statement-breakpoint
ALTER TABLE IF EXISTS "pulse_posts"
  ADD COLUMN IF NOT EXISTS "earnings" numeric(10,4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE IF EXISTS "pulse_events"
  ADD COLUMN IF NOT EXISTS "notified_live" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE IF EXISTS "legend_arena_events"
  ADD COLUMN IF NOT EXISTS "notified_live" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE IF EXISTS "dm_rooms"
  ADD COLUMN IF NOT EXISTS "revenue" numeric(14,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE IF EXISTS "dm_room_members"
  ADD COLUMN IF NOT EXISTS "last_read_at" timestamp;
--> statement-breakpoint
ALTER TABLE IF EXISTS "dm_room_members"
  ADD COLUMN IF NOT EXISTS "muted" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE IF EXISTS "users"
  ADD COLUMN IF NOT EXISTS "honor_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE IF EXISTS "users"
  ADD COLUMN IF NOT EXISTS "is_muted" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE IF EXISTS "users"
  ADD COLUMN IF NOT EXISTS "honor_title" text NOT NULL DEFAULT 'Citizen';
--> statement-breakpoint
ALTER TABLE IF EXISTS "users"
  ADD COLUMN IF NOT EXISTS "is_trending" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE IF EXISTS "users"
  ADD COLUMN IF NOT EXISTS "honor_alert_sent" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE IF EXISTS "users"
  ADD COLUMN IF NOT EXISTS "welcome_broadcast_sent" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE IF EXISTS "users"
  ADD COLUMN IF NOT EXISTS "imperial_decree_sent" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE IF EXISTS "users"
  ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp DEFAULT now();
--> statement-breakpoint
ALTER TABLE IF EXISTS "users"
  ADD COLUMN IF NOT EXISTS "is_star" boolean NOT NULL DEFAULT false;