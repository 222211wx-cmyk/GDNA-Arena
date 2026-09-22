import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  boolean,
  doublePrecision,
  index,
  uniqueIndex,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  foreignKey,
  primaryKey,
  unique,
  uuid,
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
  originalName: text("original_name"),
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

export const clipLiteMediaTable = pgTable("clip_lite_media", {
  clipId: integer("clip_id").notNull().references(() => clipsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  state: text("state").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  retryAt: timestamp("retry_at", { withTimezone: true }).notNull().defaultNow(),
  sourceObject: text("source_object"),
  outputObject: text("output_object"),
  mirrorObject: text("mirror_object"),
  sha256: text("sha256"),
  sizeBytes: integer("size_bytes"),
  mime: text("mime"),
  durationSec: doublePrecision("duration_sec"),
  mirrorVerifiedAt: timestamp("mirror_verified_at", { withTimezone: true }),
  error: text("error"),
}, t => ({
  pk: primaryKey({ columns: [t.clipId, t.kind] }),
  due: index("clip_lite_media_due").on(t.retryAt, t.clipId),
}));

export const clipMediaJobsTable = pgTable("clip_media_jobs", {
  sessionId: uuid("session_id").primaryKey().references(() => r2ClipUploadsTable.id, {onDelete:"cascade"}),
  state: text("state").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  token: uuid("token"),
  error: text("error"),
  outputObject: text("output_object"),
  retryAt: timestamp("retry_at",{withTimezone:true}).notNull().defaultNow(),
}, table => ({
  claim: index("clip_media_jobs_claim_idx").on(table.retryAt,table.sessionId)
    .where(sql`${table.state} IN ('queued','processing')`),
}));

export const r2ClipUploadsTable = pgTable("r2_clip_uploads", {
  id: uuid("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").notNull(),
  objectName: text("object_name").notNull().unique("r2_clip_uploads_object_name_key"),
  multipartUploadId: text("multipart_upload_id").notNull(),
  originalName: text("original_name").notNull(),
  displayTitle: text("display_title"),
  contentType: text("content_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  durationSec: doublePrecision("duration_sec").notNull(),
  state: text("state").notNull().default("active"),
  clipId: integer("clip_id").references(() => clipsTable.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  requestIdentity: unique("r2_clip_uploads_user_id_request_id_key").on(table.userId, table.requestId),
  sizeCheck: check("r2_clip_uploads_size_bytes_check",sql`${table.sizeBytes}>0 AND ${table.sizeBytes}<=10737418240`),
  expiry: index("r2_clip_uploads_expiry_idx")
    .on(table.expiresAt)
    .where(sql`${table.state} IN ('active', 'completing')`),
}));

export const clipLikesTable = pgTable("clip_likes", {
  clipId: integer("clip_id").notNull().references(() => clipsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  primaryKey: primaryKey({ columns: [table.clipId, table.userId] }),
  userIndex: index("clip_bookmarks_user_idx").on(table.userId),
}));

export const clipCommentsTable = pgTable("clip_comments", {
  id: serial("id").primaryKey(),
  clipId: integer("clip_id").notNull().references(() => clipsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  clipCreatedAt: index("clip_comments_clip_created_idx").on(table.clipId, table.createdAt, table.id),
}));

export const clipBookmarksTable = pgTable("clip_bookmarks", {
  clipId: integer("clip_id").notNull().references(() => clipsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  primaryKey: primaryKey({ columns: [table.clipId, table.userId] }),
  userIndex: index("clip_shares_user_idx").on(table.userId),
}));

export const clipSharesTable = pgTable("clip_shares", {
  clipId: integer("clip_id").notNull().references(() => clipsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  primaryKey: primaryKey({ columns: [table.clipId, table.userId] }),
}));