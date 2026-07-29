import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

// db is always available at runtime (DATABASE_URL is set in production/dev).
// The non-null cast prevents TS18047 errors across all route files.
export const db = (pool ? drizzle(pool, { schema }) : null) as ReturnType<typeof drizzle<typeof schema>>;

export * from "./schema";
