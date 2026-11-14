CREATE TABLE "dm_user_e2ee_keys" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"public_key" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);