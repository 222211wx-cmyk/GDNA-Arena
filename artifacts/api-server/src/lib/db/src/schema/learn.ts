import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const learnCourses = pgTable("learn_courses", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  titleAr: text("title_ar"),
  domain: text("domain").notNull(),        // sport|tech|music|business|science|art|education
  instructor: text("instructor").notNull(),
  description: text("description").notNull(),
  youtubeId: text("youtube_id"),
  duration: integer("duration").notNull().default(10), // minutes
  xpReward: integer("xp_reward").notNull().default(20),
  level: text("level").notNull().default("beginner"), // beginner|intermediate|advanced
  icon: text("icon").notNull().default("🎓"),
  totalStudents: integer("total_students").notNull().default(0),
  isLive: boolean("is_live").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const learnProgress = pgTable("learn_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  courseId: integer("course_id").notNull(),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
});
