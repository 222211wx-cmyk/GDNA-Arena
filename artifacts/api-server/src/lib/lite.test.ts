import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { pool as appPool } from "@workspace/db";
import { compactCitizen, litePage, LITE_CITIZEN_COLUMNS, LITE_VISIBILITY } from "./lite-projection";
import { CLIENT_MESSAGE_ID, messageReplay, messageRequestHash, saveMessageReceipt } from "./message-idempotency";
import { storedAvatarKey, encodeLiteAvatar } from "./lite-avatar";
after(() => appPool.end());

test("compact projection is an allowlist and enforces field/profile visibility", () => {
  const row = { id: 5, username: "citizen", display_name: "Name", bio: "x".repeat(9000),
    visibility: "everyone", avatar_url: "/private", email: "private@example.com", birth_date: "2000-01-01",
    balance: 100, city: "Secret", password_hash: "secret" };
  const profile = compactCitizen(row)!;
  assert.deepEqual(Object.keys(profile).sort(), ["avatarUrl", "bio", "displayName", "id", "username"]);
  assert.equal(profile.bio?.length, 160);
  assert.equal(compactCitizen({ ...row, visibility: "private" }), null);
  assert.equal(compactCitizen({ ...row, visibility: "friends", friend: false }, 2), null);
  assert.ok(compactCitizen({ ...row, visibility: "friends", friend: true }, 2));
  assert.ok(compactCitizen({ ...row, visibility: "private" }, 5));
  assert.equal(compactCitizen({ ...row, blocked: true }, 5), null);
  assert.equal(compactCitizen({ ...row, deleted: true }), null);
  const hidden = compactCitizen({ ...row, field_visibility: { avatarUrl: "private", bio: "friends" } })!;
  assert.equal(hidden.avatarUrl, null);
  assert.equal(hidden.bio, null);
  assert.ok(Buffer.byteLength(JSON.stringify(Array.from({ length: 20 }, () => profile))) < 12000);
});

test("pagination and avatar source cannot be expanded into unbounded requests or SSRF", () => {
  assert.deepEqual(litePage({}), { limit: 12, before: null });
  for (const query of [{ limit: 21 }, { limit: -1 }, { limit: "abc" }, { before: "1 OR 1=1" }, { before: 1.5 }]) {
    assert.equal(litePage(query), null);
  }
  const uuid = "12345678-1234-1234-1234-123456789abc";
  assert.equal(storedAvatarKey(`/api/citizen-profiles/media/5/avatar/${uuid}`, 5), `citizen-media/5/avatar/${uuid}`);
  for (const url of ["http://169.254.169.254/", "https://example.com", `/api/citizen-profiles/media/6/avatar/${uuid}`,
    `/api/citizen-profiles/media/5/cover/${uuid}`, `/api/citizen-profiles/media/5/avatar/${uuid}?url=http://localhost`]) {
    assert.equal(storedAvatarKey(url, 5), null);
  }
});

test("avatar encoder produces bounded actual WebP without upscaling", async () => {
  const source = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=24x24",
    "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"]);
  assert.equal(source.status, 0, source.stderr.toString());
  for (const slow of [true, false]) {
    const result = await encodeLiteAvatar(source.stdout, slow);
    assert.ok(result.length <= (slow ? 5120 : 10240));
    assert.equal(result.toString("ascii", 8, 12), "WEBP");
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "json", "pipe:0"], { input: result });
    const dimensions = JSON.parse(probe.stdout.toString()).streams[0];
    assert.equal(dimensions.width, 24);
    assert.equal(dimensions.height, 24);
  }
});

test("SQL read privacy filters block both directions, deleted accounts and non-mutual friends", async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE users(id int,username text,password_hash text,is_star boolean);
      CREATE TEMP TABLE citizen_profiles(user_id int,display_name text,bio text,visibility text,field_visibility jsonb,avatar_url text);
      CREATE TEMP TABLE citizen_blocks(blocker_id int,blocked_id int);
      CREATE TEMP TABLE user_follows(follower_id int,following_id int);
      INSERT INTO users SELECT n,'user'||n,CASE WHEN n=7 THEN 'DELETED' ELSE 'hash' END,n=8 FROM generate_series(1,9) n;
      INSERT INTO citizen_profiles(user_id,visibility) VALUES(2,'private'),(3,'friends'),(4,'friends');
      INSERT INTO user_follows VALUES(1,3),(3,1),(1,4);
      INSERT INTO citizen_blocks VALUES(1,5),(6,1);`);
    const query = `SELECT ${LITE_CITIZEN_COLUMNS} FROM users u LEFT JOIN citizen_profiles p ON p.user_id=u.id WHERE ${LITE_VISIBILITY} ORDER BY u.id`;
    assert.deepEqual((await client.query(query, [1])).rows.map(r => r.id), [1, 3, 9]);
    assert.deepEqual((await client.query(query, [null])).rows.map(r => r.id), [1, 5, 6, 9]);
    assert.ok((await client.query(query, [2])).rows.some(r => r.id === 2));
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});

test("concurrent sender-scoped UUID requests commit once; mismatches conflict; rollback permits retry", async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
  const sender = -randomInt(100000, 2000000000);
  const id = randomUUID();
  assert.ok(CLIENT_MESSAGE_ID.test(id));
  const hash = messageRequestHash([10, "encrypted payload"]);
  let inserts = 0;
  const send = async (requestHash = hash, abort = false, uuid = id) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const replay = await messageReplay(client, sender, uuid, requestHash);
      if (replay.conflict) { await client.query("ROLLBACK"); return "conflict"; }
      if (replay.message) { await client.query("ROLLBACK"); return replay.message.id; }
      await saveMessageReceipt(client, sender, uuid, requestHash, { id: 42 });
      if (abort) { await client.query("ROLLBACK"); return "aborted"; }
      await client.query("COMMIT");
      inserts++;
      return 42;
    } finally { client.release(); }
  };
  try {
    const responses = await Promise.all(Array.from({ length: 24 }, () => send()));
    assert.deepEqual(new Set(responses), new Set([42]));
    assert.equal(inserts, 1);
    assert.equal(await send(messageRequestHash([11, "different room"])), "conflict");
    const retryId = randomUUID();
    assert.equal(await send(hash, true, retryId), "aborted");
    assert.equal(await send(hash, false, retryId), 42);
    assert.equal(inserts, 2);
    // The same UUID is independently usable by a different sender.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      assert.equal((await messageReplay(client, sender - 1, id, hash)).message, null);
      await client.query("ROLLBACK");
    } finally { client.release(); }
  } finally {
    await pool.query("DELETE FROM dm_send_receipts WHERE sender_id=$1", [sender]);
    await pool.end();
  }
});