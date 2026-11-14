ALTER TABLE "gs_players" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "gs_players" ADD CONSTRAINT "gs_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
WITH "unambiguous_player_owners" AS (
  SELECT "player"."id", "match"."user_id"
  FROM "gs_players" AS "player"
  INNER JOIN "gs_matches" AS "match"
    ON "match"."id" = "player"."match_id"
  INNER JOIN "users"
    ON "users"."id" = "match"."user_id"
  WHERE "player"."user_id" IS NULL
    AND "player"."is_user" = true
    AND "match"."user_id" IS NOT NULL
    AND (
      SELECT COUNT(*)
      FROM "gs_players" AS "candidate"
      WHERE "candidate"."match_id" = "player"."match_id"
        AND "candidate"."is_user" = true
    ) = 1
)
UPDATE "gs_players" AS "player"
SET "user_id" = "owner"."user_id"
FROM "unambiguous_player_owners" AS "owner"
WHERE "player"."id" = "owner"."id";