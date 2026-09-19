import type { PoolClient } from "pg";

export function citizenMediaReference(url: string | null, userId: number): string | null {
  const match = url?.match(new RegExp(`^/api/citizen-profiles/media/${userId}/(avatar|cover)/([a-f0-9-]{36})$`));
  return match ? `r2:citizen-media/${userId}/${match[1]}/${match[2]}` : null;
}
/** Reuse the durable storage outbox; negative scope IDs never collide with clip IDs. */
export async function deleteAccountCitizenSocial(client: PoolClient, userId: number): Promise<void> {
  const { rows } = await client.query("SELECT avatar_url,cover_url FROM citizen_profiles WHERE user_id=$1 FOR UPDATE", [userId]);
  for (const url of [rows[0]?.avatar_url, rows[0]?.cover_url]) {
    const reference = citizenMediaReference(url, userId);
    if (reference) await client.query(`INSERT INTO clip_storage_cleanup(object_name,clip_id) VALUES($1,$2)
      ON CONFLICT(object_name) DO UPDATE SET retry_at=NOW()`, [reference, -userId]);
  }
  await client.query("UPDATE clip_storage_cleanup SET retry_at=NOW() WHERE clip_id=$1 AND object_name LIKE 'r2:citizen-media/%'", [-userId]);
  await client.query("DELETE FROM citizen_listings WHERE user_id=$1", [userId]);
  await client.query("DELETE FROM citizen_profiles WHERE user_id=$1", [userId]);
}