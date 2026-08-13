import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(), // xp_earned | coins_earned | rank_up | debate_win | event_joined | story_liked | post_liked | celebration_winner | event_live
  title: text("title").notNull(),
  body: text("body").notNull(),
  icon: text("icon").notNull().default("⚡"),
  isRead: boolean("is_read").notNull().default(false),
  linkPath: text("link_path"),             // optional deep-link
  sourceRef: text("source_ref"),           // event-specific dedup key e.g. "pulse_events:42"
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
