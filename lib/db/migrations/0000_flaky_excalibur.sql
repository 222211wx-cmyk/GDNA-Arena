CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"balance" integer DEFAULT 500 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"last_daily_reward" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gs_figures" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"nationality" text DEFAULT '' NOT NULL,
	"image_url" text,
	"votes" integer DEFAULT 0 NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gs_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"placement" integer NOT NULL,
	"total_players" integer DEFAULT 100 NOT NULL,
	"coins_earned" integer DEFAULT 0 NOT NULL,
	"xp_earned" integer DEFAULT 0 NOT NULL,
	"tier" text DEFAULT 'citizen' NOT NULL,
	"is_win" boolean DEFAULT false NOT NULL,
	"played_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gs_media" (
	"id" serial PRIMARY KEY NOT NULL,
	"figure_id" integer NOT NULL,
	"domain" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"thumbnail_url" text,
	"duration_sec" integer,
	"platform" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gs_news" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"domain" text NOT NULL,
	"source" text NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"image_url" text,
	"is_breaking" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gs_players" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"username" text NOT NULL,
	"is_user" boolean DEFAULT false NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"placement" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gs_traditions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"image_url" text,
	"period" text NOT NULL,
	"is_archaeological" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gs_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"figure_id" integer NOT NULL,
	"voter_ip" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archon_directives" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_id" integer,
	"dimension" text,
	"directive" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "archon_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"volontas" integer DEFAULT 0 NOT NULL,
	"resilentia" integer DEFAULT 0 NOT NULL,
	"intellectus" integer DEFAULT 0 NOT NULL,
	"disciplina" integer DEFAULT 0 NOT NULL,
	"societas" integer DEFAULT 0 NOT NULL,
	"abundantia" integer DEFAULT 0 NOT NULL,
	"auctoritas" integer DEFAULT 0 NOT NULL,
	"archon_code" text NOT NULL,
	"archetype" text,
	"ai_profile" jsonb,
	"answers" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;