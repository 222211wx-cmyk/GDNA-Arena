import { pool as sharedPool } from "./db";

export type DeletePulsePostResult = "deleted" | "not_found" | "forbidden";

/**
 * Canonical deletion for posts shared by Empire Pulse and Social Hub.
 * Related social activity is removed atomically; historical finance rows are
 * intentionally not touched.
 */
export async function deletePulsePostForOwner(
  postId: number,
  ownerId: number,
): Promise<DeletePulsePostResult> {
  if (!sharedPool) throw new Error("Database pool unavailable");

  const client = await sharedPool.connect();
  try {
    await client.query("BEGIN");
    const postResult = await client.query<{ user_id: number | null }>(
      "SELECT user_id FROM pulse_posts WHERE id = $1 FOR UPDATE",
      [postId],
    );
    const post = postResult.rows[0];
    if (!post) {
      await client.query("ROLLBACK");
      return "not_found";
    }
    if (post.user_id !== ownerId) {
      await client.query("ROLLBACK");
      return "forbidden";
    }

    const comments = await client.query<{ id: number }>(
      "SELECT id FROM post_comments WHERE post_id = $1",
      [postId],
    );
    const reactions = await client.query<{ id: number }>(
      "SELECT id FROM post_reactions WHERE post_id = $1",
      [postId],
    );
    const sourceRefs = [
      ...comments.rows.map(({ id }) => `social-comment:${id}`),
      ...reactions.rows.map(({ id }) => `social-reaction:${id}`),
    ];
    if (sourceRefs.length > 0) {
      await client.query(
        "DELETE FROM notifications WHERE source_ref = ANY($1::text[])",
        [sourceRefs],
      );
    }

    await client.query("DELETE FROM post_comments WHERE post_id = $1", [postId]);
    await client.query("DELETE FROM post_reactions WHERE post_id = $1", [postId]);
    await client.query("DELETE FROM saved_posts WHERE post_id = $1", [postId]);
    await client.query("DELETE FROM pulse_post_likes WHERE post_id = $1", [postId]);
    await client.query("DELETE FROM pulse_posts WHERE id = $1", [postId]);
    await client.query("COMMIT");
    return "deleted";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
