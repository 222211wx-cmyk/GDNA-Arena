import { jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface StoredClipVisualSignature {
  version: 1;
  frames: string[];
}

export type StoredClipAudioSignature = Record<string, unknown>;

/**
 * A citizen's durable declaration that a clip is an original work.
 *
 * clipId intentionally has no foreign key to clips: declarations and their
 * signatures remain as protection records after a published clip is deleted.
 */
export const clipOriginalRegistrationsTable = pgTable("clip_original_registrations", {
  id: serial("id").primaryKey(),
  clipId: integer("clip_id").notNull(),
  userId: integer("user_id").notNull(),
  originalReference: text("original_reference").notNull(),
  rightsHolderName: text("rights_holder_name").notNull(),
  rightsHolderRole: text("rights_holder_role").notNull(),
  durationSeconds: numeric("duration_seconds", { precision: 12, scale: 3, mode: "number" }).notNull(),
  visualSignature: jsonb("visual_signature").$type<StoredClipVisualSignature | null>(),
  audioSignature: jsonb("audio_signature").$type<StoredClipAudioSignature | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  clipUnique: uniqueIndex("clip_original_registrations_clip_id_uniq").on(table.clipId),
}));

export const insertClipOriginalRegistrationSchema = createInsertSchema(clipOriginalRegistrationsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertClipOriginalRegistration = z.infer<typeof insertClipOriginalRegistrationSchema>;
export type ClipOriginalRegistration = typeof clipOriginalRegistrationsTable.$inferSelect;