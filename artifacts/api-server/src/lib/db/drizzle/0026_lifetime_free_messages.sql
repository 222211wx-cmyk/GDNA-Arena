-- Existing citizens keep only their unused portion of the lifetime trial.
-- Count authored messages, not current room membership; cap at ten so
-- prolific users do not get a reset. Future deletion cannot change this cursor.
ALTER TABLE "users" ADD COLUMN "free_messages_used" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "users" u SET "free_messages_used" = LEAST(10, (
  SELECT COUNT(*)::integer FROM "dm_messages" m WHERE m.user_id = u.id
));
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_free_messages_used_range"
  CHECK ("free_messages_used" BETWEEN 0 AND 10);