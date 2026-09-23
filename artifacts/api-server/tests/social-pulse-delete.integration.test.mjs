import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const base = process.env.API_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const db = new Client({ connectionString: process.env.DATABASE_URL });
const users = [];
const postIds = [];
const notificationRefs = [];

async function call(path, { cookie, method = "GET", data } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(data ? { "content-type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return {
    status: response.status,
    body,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

async function signup(username) {
  const response = await call("/auth/register", {
    method: "POST",
    data: {
      username,
      password: "disposable-social-delete-2026",
      birthDate: "1990-01-01",
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const row = (await db.query("SELECT id FROM users WHERE username = $1", [username])).rows[0];
  const user = { id: row.id, username, cookie: response.cookie };
  users.push(user);
  return user;
}

async function createPost(owner, domain, content) {
  const response = await call("/pulse/post", {
    cookie: owner.cookie,
    method: "POST",
    data: { domain, content, type: "post" },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  postIds.push(response.body.post.id);
  return response.body.post;
}

test("published Social/Pulse posts have no age expiry and deletion is owner-only", { timeout: 120000 }, async t => {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(process.env.REPLIT_DEV_DOMAIN || process.env.API_BASE_URL);
  await db.connect();

  t.after(async () => {
    const errors = [];
    try {
      if (postIds.length > 0) {
        await db.query("BEGIN");
        if (notificationRefs.length > 0) {
          await db.query("DELETE FROM notifications WHERE source_ref = ANY($1::text[])", [notificationRefs]);
        }
        await db.query("DELETE FROM post_comments WHERE post_id = ANY($1::int[])", [postIds]);
        await db.query("DELETE FROM post_reactions WHERE post_id = ANY($1::int[])", [postIds]);
        await db.query("DELETE FROM saved_posts WHERE post_id = ANY($1::int[])", [postIds]);
        await db.query("DELETE FROM pulse_post_likes WHERE post_id = ANY($1::int[])", [postIds]);
        await db.query("DELETE FROM pulse_posts WHERE id = ANY($1::int[])", [postIds]);
        await db.query("COMMIT");
      }
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      errors.push(error);
    }
    for (const user of users) {
      try {
        const response = await call("/auth/me", { cookie: user.cookie, method: "DELETE" });
        assert.equal(response.status, 200, JSON.stringify(response.body));
      } catch (error) {
        errors.push(error);
      }
    }
    await db.end();
    assert.deepEqual(errors.map(error => error.message), []);
  });

  const suffix = Date.now().toString(36);
  const owner = await signup(`spdo${suffix}`);
  const other = await signup(`spdx${suffix}`);
  const domain = `delete-test-${suffix}`;
  const aged = await createPost(owner, domain, "An old published post that must remain visible");
  const pulseOwned = await createPost(owner, domain, "Delete through the Pulse route");
  const unrelated = await createPost(other, domain, "Unrelated post and activity must remain");

  await db.query(
    "UPDATE pulse_posts SET created_at = now() - interval '3 years' WHERE id = ANY($1::int[])",
    [[aged.id, pulseOwned.id]],
  );

  await t.test("aged published posts remain in both feeds with no expiry filter", async () => {
    const social = await call(`/social/v2/feed?domain=${encodeURIComponent(domain)}&limit=100`);
    assert.equal(social.status, 200, JSON.stringify(social.body));
    assert.ok(social.body.posts.some(post => post.id === aged.id));

    const pulse = await call(`/pulse/feed?domain=${encodeURIComponent(domain)}&limit=50`);
    assert.equal(pulse.status, 200, JSON.stringify(pulse.body));
    assert.ok(pulse.body.posts.some(post => post.id === aged.id));
  });

  const comment = (await db.query(
    "INSERT INTO post_comments (post_id, user_id, username, content) VALUES ($1, $2, $3, $4) RETURNING id",
    [aged.id, other.id, other.username, "related comment"],
  )).rows[0];
  const reaction = (await db.query(
    "INSERT INTO post_reactions (post_id, user_id, username, voter_ip, reaction) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [aged.id, other.id, other.username, `delete-test:${suffix}`, "❤️"],
  )).rows[0];
  await db.query("INSERT INTO saved_posts (user_id, post_id) VALUES ($1, $2)", [other.id, aged.id]);
  await db.query("INSERT INTO pulse_post_likes (post_id, voter_ip) VALUES ($1, $2)", [aged.id, `delete-test:${suffix}`]);
  await db.query(
    "INSERT INTO notifications (user_id, type, title, body, icon, source_ref) VALUES ($1, 'comment', 'test', 'test', '💬', $2), ($1, 'reaction', 'test', 'test', '❤️', $3)",
    [owner.id, `social-comment:${comment.id}`, `social-reaction:${reaction.id}`],
  );
  notificationRefs.push(`social-comment:${comment.id}`, `social-reaction:${reaction.id}`);
  const unrelatedComment = (await db.query(
    "INSERT INTO post_comments (post_id, user_id, username, content) VALUES ($1, $2, $3, $4) RETURNING id",
    [unrelated.id, owner.id, owner.username, "unrelated comment"],
  )).rows[0];
  const financeBefore = Number((await db.query(
    "SELECT count(*)::int AS count FROM transactions WHERE user_id = $1 AND type = 'post'",
    [owner.id],
  )).rows[0].count);

  await t.test("unauthenticated and non-owner deletion are rejected", async () => {
    assert.equal((await call(`/pulse/post/${aged.id}`, { method: "DELETE" })).status, 401);
    assert.equal((await call(`/social/v2/post/${aged.id}`, { cookie: other.cookie, method: "DELETE" })).status, 403);
    assert.equal(Number((await db.query("SELECT count(*)::int AS count FROM pulse_posts WHERE id = $1", [aged.id])).rows[0].count), 1);
  });

  await t.test("owner deletion cleans only related social rows and preserves finance history", async () => {
    const response = await call(`/social/v2/post/${aged.id}`, { cookie: owner.cookie, method: "DELETE" });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    for (const table of ["pulse_posts", "post_comments", "post_reactions", "saved_posts", "pulse_post_likes"]) {
      const column = table === "pulse_posts" ? "id" : "post_id";
      const count = Number((await db.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${column} = $1`, [aged.id])).rows[0].count);
      assert.equal(count, 0, `${table} retained related rows`);
    }
    assert.equal(Number((await db.query(
      "SELECT count(*)::int AS count FROM notifications WHERE source_ref = ANY($1::text[])",
      [[`social-comment:${comment.id}`, `social-reaction:${reaction.id}`]],
    )).rows[0].count), 0);
    assert.equal(Number((await db.query("SELECT count(*)::int AS count FROM post_comments WHERE id = $1", [unrelatedComment.id])).rows[0].count), 1);
    assert.equal(Number((await db.query(
      "SELECT count(*)::int AS count FROM transactions WHERE user_id = $1 AND type = 'post'",
      [owner.id],
    )).rows[0].count), financeBefore);
  });

  await t.test("Pulse owner route deletes the same canonical post identity", async () => {
    const response = await call(`/pulse/post/${pulseOwned.id}`, { cookie: owner.cookie, method: "DELETE" });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(Number((await db.query("SELECT count(*)::int AS count FROM pulse_posts WHERE id = $1", [pulseOwned.id])).rows[0].count), 0);
    assert.equal((await call(`/social/v2/post/${pulseOwned.id}`, { cookie: owner.cookie, method: "DELETE" })).status, 404);
  });
});