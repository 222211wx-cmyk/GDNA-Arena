import { pgTable, serial, text, integer, boolean, timestamp, unique } from "drizzle-orm/pg-core";

// Emoji reactions on feed posts (❤️ 😂 😮 😡 👏)
export const postReactions = pgTable("post_reactions", {
  id:        serial("id").primaryKey(),
  postId:    integer("post_id").notNull(),
  userId:    integer("user_id"),
  username:  text("username").notNull().default("Anonymous"),
  voterIp:   text("voter_ip").notNull(),
  reaction:  text("reaction").notNull().default("❤️"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ uniq: unique().on(t.postId, t.voterIp) }));

// Comments on feed posts
export const postComments = pgTable("post_comments", {
  id:        serial("id").primaryKey(),
  postId:    integer("post_id").notNull(),
  userId:    integer("user_id"),
  username:  text("username").notNull().default("Anonymous"),
  content:   text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Citizen follow relationships
export const userFollows = pgTable("user_follows", {
  id:          serial("id").primaryKey(),
  followerId:  integer("follower_id").notNull(),
  followingId: integer("following_id").notNull(),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ uniq: unique().on(t.followerId, t.followingId) }));
