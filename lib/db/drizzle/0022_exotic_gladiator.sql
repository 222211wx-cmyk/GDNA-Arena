CREATE TABLE "clip_original_registrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"clip_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"original_reference" text NOT NULL,
	"rights_holder_name" text NOT NULL,
	"rights_holder_role" text NOT NULL,
	"duration_seconds" numeric(12, 3) NOT NULL,
	"visual_signature" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "clip_original_registrations_clip_id_uniq" ON "clip_original_registrations" USING btree ("clip_id");