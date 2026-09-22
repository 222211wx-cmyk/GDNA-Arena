import { canSeeCitizen, citizenFieldVisible } from "./citizen-policy";

export function compactCitizen(row: Record<string, any>, viewerId?: number) {
  const self = row.id === viewerId;
  const friend = Boolean(row.friend);
  const visibility = row.visibility ?? "everyone";
  if (row.blocked || row.deleted || row.is_star || !canSeeCitizen(visibility, self, friend)) return null;
  const visible = (field: string) => citizenFieldVisible(visibility, row.field_visibility?.[field], self, friend);
  return {
    id: row.id,
    username: String(row.username).slice(0, 80),
    displayName: String(row.display_name || row.username).slice(0, 80),
    bio: visible("bio") ? String(row.bio ?? "").slice(0, 160) : null,
    avatarUrl: visible("avatarUrl") && row.avatar_url ? `/api/lite/avatar/${encodeURIComponent(row.username)}` : null,
  };
}

// SQL filters before pagination, so hidden accounts never consume a cursor slot.
export const LITE_VISIBILITY = `
 u.password_hash <> 'DELETED' AND u.is_star = FALSE
 AND NOT EXISTS (SELECT 1 FROM citizen_blocks b WHERE
 (b.blocker_id=$1 AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=$1))
 AND (u.id=$1 OR COALESCE(p.visibility,'everyone')='everyone' OR
 (p.visibility='friends' AND EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_id=$1 AND f.following_id=u.id)
 AND EXISTS(SELECT 1 FROM user_follows f WHERE f.following_id=$1 AND f.follower_id=u.id)))`;
export const LITE_CITIZEN_COLUMNS = `u.id,u.username,p.display_name,p.bio,p.visibility,p.field_visibility,p.avatar_url,
 (EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_id=$1 AND f.following_id=u.id)
 AND EXISTS(SELECT 1 FROM user_follows f WHERE f.following_id=$1 AND f.follower_id=u.id)) AS friend`;

export function litePage(query: Record<string, unknown>) {
  const limit = query.limit === undefined ? 12 : Number(query.limit);
  const before = query.before === undefined ? null : Number(query.before);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20 ||
    (before !== null && (!Number.isSafeInteger(before) || before < 1 || before > 2147483647))) return null;
  return { limit, before };
}