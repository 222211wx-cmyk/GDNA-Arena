import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  foreignKey,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * The complete shape of the legacy clips table.
 *
 * Keep every existing column represented here: the clips-only push config is
 * intentionally scoped to this table so Drizzle cannot treat unrelated runtime
 * tables as deletion candidates.
 */
export const clipsTable = pgTable("clips", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  username: text("username").notNull(),
  title: text("title").notNull(),
  objectName: text("object_name").notNull(),
  thumbnailObjectName: text("thumbnail_object_name"),
  contentType: text("content_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
  durationSec: integer("duration_sec").notNull(),
  views: integer("views").notNull().default(0),
  earnings: numeric("earnings", { precision: 14, scale: 4 }).notNull().default("0"),
  isFrozen: boolean("is_frozen").notNull().default(false),
  isOriginalFootage: boolean("is_original_footage").notNull().default(true),
  thumbnailRetryAttempts: integer("thumbnail_retry_attempts").notNull().default(0),
  thumbnailRetryAt: timestamp("thumbnail_retry_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userForeignKey: foreignKey({
    name: "clips_user_id_fkey",
    columns: [table.userId],
    foreignColumns: [usersTable.id],
  }),
  thumbnailRetryDue: index("clips_thumbnail_retry_due_idx")
    .on(table.thumbnailRetryAt, table.id)
    .where(sql`${table.thumbnailObjectName} IS NULL AND ${table.isFrozen} = FALSE AND ${table.thumbnailRetryAttempts} < 8`),
}));