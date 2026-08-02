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

// Saved / bookmarked posts
export const savedPosts = pgTable("saved_posts", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull(),
  postId:    integer("post_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ uniq: unique().on(t.userId, t.postId) }));

// Call history
export const callHistory = pgTable("call_history", {
  id:              serial("id").primaryKey(),
  callerId:        integer("caller_id").notNull(),
  callerUsername:  text("caller_username").notNull().default(""),
  calleeId:        integer("callee_id"),
  calleeUsername:  text("callee_username").notNull().default(""),
  callType:        text("call_type").notNull().default("audio"),   // audio | video
  status:          text("status").notNull().default("missed"),     // answered | missed | ended
  durationSec:     integer("duration_sec").notNull().default(0),
  startedAt:       timestamp("started_at").notNull().defaultNow(),
});
