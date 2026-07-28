import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Auto-create tables if they don't exist (no migration tooling needed)
async function ensureTables() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "gs_figures" (
        "id" serial PRIMARY KEY,
        "name" text NOT NULL,
        "domain" text NOT NULL,
        "nationality" text DEFAULT '' NOT NULL,
        "image_url" text,
        "votes" integer DEFAULT 0 NOT NULL,
        "bio" text DEFAULT '' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    logger.info("Tables verified");
  } catch (err) {
    logger.warn({ err }, "Table ensure skipped");
  }
}

ensureTables().then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
});
