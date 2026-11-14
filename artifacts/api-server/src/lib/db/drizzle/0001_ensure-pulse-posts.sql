-- Keep a brand-new development database compatible with the baseline repair:
-- the baseline alters this pre-existing project table, while this migration
-- creates its complete current shape when no startup-created table exists yet.
CREATE TABLE IF NOT EXISTS "pulse_posts" (
  "id" serial PRIMARY KEY,
  "user_id" integer,
  "username" text DEFAULT 'Anonymous' NOT NULL,
  "avatar" text,
  "content" text NOT NULL,
  "image_url" text,
  "media_type" text,
  "domain" text DEFAULT 'general' NOT NULL,
  "type" text DEFAULT 'post' NOT NULL,
  "likes" integer DEFAULT 0 NOT NULL,
  "earnings" numeric(10,4) DEFAULT 0 NOT NULL,
  "is_visible" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);