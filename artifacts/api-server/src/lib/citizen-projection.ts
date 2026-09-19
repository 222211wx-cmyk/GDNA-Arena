import { pool } from "@workspace/db";
import { CitizenOwnProfileResponse } from "@workspace/api-zod";
import { ageFromBirthDate } from "./age";
import { canSeeCitizen, citizenFieldVisible } from "./citizen-policy";

export async function citizenBlocked(a: number | undefined, b: number): Promise<boolean> {
  if (!a || a === b) return false;
  const result = await pool.query("SELECT 1 FROM citizen_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1) LIMIT 1", [a, b]);
  return result.rowCount !== 0;
}
export async function citizenIdentity(username: string) {
  const { rows } = await pool.query<{ id: number; username: string; birth_date: string | Date | null }>("SELECT id,username,birth_date FROM users WHERE lower(username)=lower($1) AND password_hash <> 'DELETED'", [username]);
  return rows[0];
}
export async function citizenProjection(userId: number, viewerId?: number) {
  if (await citizenBlocked(viewerId, userId)) return null;
  const { rows } = await pool.query(`SELECT u.id,u.username,u.birth_date,p.*
    FROM users u LEFT JOIN citizen_profiles p ON p.user_id=u.id WHERE u.id=$1 AND u.password_hash <> 'DELETED'`, [userId]);
  const row = rows[0];
  if (!row) return null;
  const self = userId === viewerId;
  const relations = await pool.query(`SELECT
    EXISTS(SELECT 1 FROM user_follows WHERE follower_id=$2 AND following_id=$1) AS follows,
    EXISTS(SELECT 1 FROM user_follows WHERE follower_id=$1 AND following_id=$2) AS followed,
    (SELECT count(*)::int FROM user_follows WHERE following_id=$1) AS followers,
    (SELECT count(*)::int FROM user_follows WHERE follower_id=$1) AS following`, [userId, viewerId ?? 0]);
  const rel = relations.rows[0];
  const friend = rel.follows && rel.followed;
  const visibility = row.visibility ?? "everyone";
  const visible = canSeeCitizen(visibility, self, friend);
  const fields = row.field_visibility ?? {};
  // Profiles absent from the social layer reveal only existing public identity.
  const field = (name: string) => Boolean(row.user_id) && citizenFieldVisible(visibility, fields[name], self, friend);
  const age = ageFromBirthDate(row.birth_date);
  const videos = field("videos") ? (await pool.query(`SELECT id,title,thumbnail_object_name FROM clips WHERE user_id=$1 AND is_frozen=FALSE AND object_name IS NOT NULL ORDER BY id DESC LIMIT 30`, [userId])).rows.map(c => ({
    id: c.id, title: c.title, url: `/api/clips/stream/${c.id}`, thumbnailUrl: c.thumbnail_object_name ? `/api/clips/thumbnail/${c.id}` : null,
  })) : [];
  return CitizenOwnProfileResponse.parse({
    userId, username: row.username, displayName: visible && row.display_name ? row.display_name : row.username,
    avatarUrl: field("avatarUrl") ? row.avatar_url : null, coverUrl: field("coverUrl") ? row.cover_url : null,
    city: field("city") ? row.city : null, age: field("age") ? age : null, bio: field("bio") ? row.bio : null,
    interests: field("interests") ? row.interests : [],
    status: visible && age !== null && age >= 18 ? row.status ?? "private" : "private",
    visibility, stats: visible ? { views: row.views ?? 0, followers: rel.followers, following: rel.following } : { views: 0, followers: 0, following: 0 },
    isFollowing: rel.follows, isFriend: friend, isSelf: self,
    canMessage: Boolean(viewerId && !self && visible),
    mapDiscoverable: Boolean(visible && field("city") && row.map_discoverable), videos,
    ...(self ? { fieldVisibility: fields, aiConsent: row.ai_consent ?? false } : {}),
  });
}