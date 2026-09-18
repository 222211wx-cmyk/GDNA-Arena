import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  uniqueIndex,
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
  code: text("code"),
  // Retained immutable ORIGINAL plus finalization identity after derived swaps.
  // Only explicit clip/account deletion is allowed to release this reference.
  uploadObjectName: text("upload_object_name"),
  processingStatus: text("processing_status").notNull().default("ready"),
  processingAttempts: integer("processing_attempts").notNull().default(0),
  processingRetryAt: timestamp("processing_retry_at", { withTimezone: true }).notNull().defaultNow(),
  processingOutputObject: text("processing_output_object"),
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
  codeUnique: uniqueIndex("clips_code_unique").on(table.code),
  userForeignKey: foreignKey({
    name: "clips_user_id_fkey",
    columns: [table.userId],
    foreignColumns: [usersTable.id],
  }),
  thumbnailRetryDue: index("clips_thumbnail_retry_due_idx")
    .on(table.thumbnailRetryAt, table.id)
    .where(sql`${table.thumbnailObjectName} IS NULL AND ${table.isFrozen} = FALSE AND ${table.thumbnailRetryAttempts} < 8`),
  processingDue: index("clips_processing_due_idx").on(table.processingRetryAt, table.id)
    .where(sql`${table.processingStatus} IN ('queued', 'processing')`),
}));