// STUB replacing the missing @workspace/db package (lib/db is not in this repo).
// `pool` is a real pg Pool; `db` is drizzle over it. Table objects are untyped
// placeholders, so drizzle queries that use them will NOT work until the real
// schema is restored.
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

export const pool = (process.env["DATABASE_URL"]
  ? new pg.Pool({ connectionString: process.env["DATABASE_URL"] })
  : null) as pg.Pool;
export const db: any = pool ? drizzle(pool) : null;

const table = (): any => new Proxy({}, { get: (_t, key) => String(key) });

export const archonDirectivesTable = table();
export const archonSessionsTable = table();
export const celebrationEntries = table();
export const celebrationLikes = table();
export const celebrations = table();
export const citizenListingsTable = table();
export const citizenProfilesTable = table();
export const dmMessages = table();
export const dmRoomMembers = table();
export const dmRooms = table();
export const gsMediaTable = table();
export const learnCourses = table();
export const learnProgress = table();
export const notifications = table();
export const platformStories = table();
export const pulseEvents = table();
export const pulsePostLikes = table();
export const pulsePosts = table();
export const storyLikes = table();
export const transactionsTable = table();
export const usersTable = table();
export const callHistory = table();
export const gsMatchesTable = table();
export const gsPlayersTable = table();
export const legendArenaEventsTable = table();
export const legendDebatesTable = table();
export const legendStoriesTable = table();
export const legendWatchesTable = table();
export const legendsTable = table();
export const postComments = table();
export const postReactions = table();
export const savedPosts = table();
export const userFollows = table();
