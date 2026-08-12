import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

// Social posts feed
export const pulsePosts = pgTable("pulse_posts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  username: text("username").notNull().default("Anonymous"),
  avatar: text("avatar"),                      // initials fallback
  content: text("content").notNull(),
  imageUrl: text("image_url"),                 // optional attached image
  domain: text("domain").notNull().default("general"), // sport|tech|music|business|general
  type: text("type").notNull().default("post"), // post|victory|tribute|vision
  likes: integer("likes").notNull().default(0),
  isVisible: boolean("is_visible").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// International events calendar
export const pulseEvents = pgTable("pulse_events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  titleAr: text("title_ar"),
  domain: text("domain").notNull(),            // sport|tech|music|business|cinema|culture
  location: text("location").notNull(),
  country: text("country").notNull().default(""),
  eventDate: text("event_date").notNull(),     // ISO string or "LIVE"
  isLive: boolean("is_live").notNull().default(false),
  icon: text("icon").notNull().default("🌍"),
  color: text("color").notNull().default("#C9A84C"),
  impactScore: integer("impact_score").notNull().default(50), // 0-100
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Post likes (prevent double-like)
export const pulsePostLikes = pgTable("pulse_post_likes", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull(),
  voterIp: text("voter_ip").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
