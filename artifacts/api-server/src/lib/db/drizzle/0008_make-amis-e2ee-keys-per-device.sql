ALTER TABLE "dm_user_e2ee_keys" DROP CONSTRAINT "dm_user_e2ee_keys_pkey";--> statement-breakpoint
ALTER TABLE "dm_user_e2ee_keys" ADD COLUMN "device_id" text;--> statement-breakpoint
-- The preceding migration and this one ship together; clear any development-only
-- user-level keys because they cannot be mapped safely to a browser device.
DELETE FROM "dm_user_e2ee_keys";--> statement-breakpoint
ALTER TABLE "dm_user_e2ee_keys" ALTER COLUMN "device_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dm_user_e2ee_keys" ADD CONSTRAINT "dm_user_e2ee_keys_user_id_device_id_pk" PRIMARY KEY("user_id","device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dm_user_e2ee_keys_user_fingerprint" ON "dm_user_e2ee_keys" USING btree ("user_id","fingerprint");