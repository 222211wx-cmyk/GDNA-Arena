import test from "node:test";
import assert from "node:assert/strict";
import { canSeeCitizen, citizenFieldVisible, citizenCompatibility, assistantConsentAllowed, citizenImageType } from "./citizen-policy";
import { CitizenSaveProfileBody, CitizenOwnProfileResponse, CitizenAssistantBody } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { citizenProjection } from "./citizen-projection";
import { validateCitizenImage } from "./citizen-image";
import { citizenMediaReference, deleteAccountCitizenSocial } from "./citizen-media-cleanup";
import { runClipStorageCleanupBatch } from "../jobs/clip-storage-cleanup";
import { r2Client, r2Config } from "./r2-storage";
import { PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

test("access classes and block override", () => {
  for (const visibility of ["everyone", "friends", "private"]) {
    assert.equal(canSeeCitizen(visibility, true, false), true);
    assert.equal(canSeeCitizen(visibility, false, false), visibility === "everyone");
    assert.equal(canSeeCitizen(visibility, false, true), visibility !== "private");
    assert.equal(canSeeCitizen(visibility, true, true, true), false);
  }
});
test("field rules cannot widen whole-profile access", () => {
  assert.equal(citizenFieldVisible("private", "everyone", false, true), false);
  assert.equal(citizenFieldVisible("everyone", "private", false, true), false);
  assert.equal(citizenFieldVisible("everyone", "friends", false, true), true);
  assert.equal(citizenFieldVisible("everyone", "friends", false, false), false);
  assert.equal(citizenFieldVisible("private", "private", true, false), true);
});
test("compatibility is deterministic explained visible-interest/city heuristic", () => {
  const p = { city: "Rabat", interests: ["Music", "Art"] };
  const q = { city: "Rabat", interests: ["Music"] };
  assert.equal(citizenCompatibility(p,q).percent, 60);
  assert.equal(citizenCompatibility(p,q).method, "shared-interests-city-heuristic");
  assert.match(citizenCompatibility(p,q).explanation, /not AI inference/);
  assert.equal(citizenCompatibility({ city: null, interests: [] }, { city: null, interests: [] }).percent, 0);
});
test("assistant requires saved and per-request consent, plus explicit E2EE text", () => {
  assert.equal(assistantConsentAllowed(false, true, "profile"), false);
  assert.equal(assistantConsentAllowed(true, false, "profile"), false);
  assert.equal(assistantConsentAllowed(true, true, "translate"), false);
  assert.equal(assistantConsentAllowed(true, true, "auto-reply", " "), false);
  assert.equal(assistantConsentAllowed(true, true, "auto-reply", "User-supplied text"), true);
  assert.equal(CitizenAssistantBody.strict().safeParse({ section: "profile", consent: true, roomId: 9 }).success, false);
});
test("schema prevents identity and birthdate spoofing", () => {
  for (const field of ["userId", "username", "birthDate", "phone", "avatarUrl"]) {
    assert.equal(CitizenSaveProfileBody.strict().safeParse({ [field]: "spoof" }).success, false);
  }
  assert.equal(CitizenSaveProfileBody.safeParse({ bio: "x".repeat(1001) }).success, false);
});
test("image signatures reject executable/svg payloads and fake webp length", () => {
  assert.equal(citizenImageType(Buffer.from("<svg onload='alert(1)'></svg>")), null);
  assert.equal(citizenImageType(Buffer.from("RIFFxxxxWEBPxxxxxxxx")), null);
});
test("media cleanup reference scopes deletion to exact owner image URLs", () => {
  const url = "/api/citizen-profiles/media/123/avatar/00000000-0000-0000-0000-000000000000";
  assert.equal(citizenMediaReference(url, 123), "r2:citizen-media/123/avatar/00000000-0000-0000-0000-000000000000");
  assert.equal(citizenMediaReference(url, 456), null);
  assert.equal(citizenMediaReference("r2:clips/original/file", 123), null);
});
test("image decoder rejects truncated files even with plausible signatures", async () => {
  const fake = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(4), Buffer.from("IHDR")]);
  assert.equal(citizenImageType(fake), "image/png");
  assert.equal(await validateCitizenImage(fake), false);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64");
  assert.equal(await validateCitizenImage(png), true);
});

test("persistent projection filters strangers, friends, owner, blocks and absent profiles", async () => {
  assert.notEqual(process.env.NODE_ENV, "production", "Tests must never write production");
  const marker = `citizen_test_${Date.now()}`;
  const ids: number[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      const result = await pool.query("INSERT INTO users(username,email,password_hash,birth_date) VALUES($1,$2,'TEST_ONLY','2000-01-01') RETURNING id", [`${marker}_${i}`, `${marker}_${i}@example.invalid`]);
      ids.push(result.rows[0].id);
    }
    const [owner, viewer, bare] = ids;
    await pool.query(`INSERT INTO citizen_profiles(user_id,display_name,bio,city,interests,status,field_visibility)
      VALUES($1,'Display','secret bio','Rabat','["Music"]','available','{"bio":"friends","age":"private"}')`, [owner]);
    const stranger = await citizenProjection(owner!);
    assert.ok(stranger);
    assert.equal(stranger.bio, null);
    assert.equal(stranger.age, null);
    assert.equal(stranger.city, "Rabat");
    assert.equal("phone" in stranger, false);
    assert.equal("birthDate" in stranger, false);
    assert.equal("aiConsent" in stranger, false);
    assert.equal(CitizenOwnProfileResponse.safeParse(stranger).success, true);
    await pool.query("INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2),($2,$1)", [owner,viewer]);
    const friend = await citizenProjection(owner!, viewer);
    assert.equal(friend?.isFriend, true);
    assert.equal(friend?.bio, "secret bio");
    assert.equal(friend?.age, null);
    const own = await citizenProjection(owner!, owner);
    assert.ok(own?.age && own.age >= 18);
    assert.equal(own?.bio, "secret bio");
    await pool.query("UPDATE users SET birth_date=NULL WHERE id=$1", [owner]);
    assert.equal((await citizenProjection(owner!, owner))?.age, null);
    assert.equal((await citizenProjection(owner!, owner))?.status, "private");
    await pool.query("UPDATE users SET birth_date=(CURRENT_DATE - INTERVAL '10 years')::date WHERE id=$1", [owner]);
    assert.equal((await citizenProjection(owner!, owner))?.age, 10);
    assert.equal((await citizenProjection(owner!, owner))?.status, "private");
    await pool.query("UPDATE citizen_profiles SET visibility='private' WHERE user_id=$1", [owner]);
    assert.equal((await citizenProjection(owner!, viewer))?.city, null);
    assert.equal((await citizenProjection(owner!, viewer))?.canMessage, false);
    const absent = await citizenProjection(bare!);
    assert.equal(absent?.age, null);
    assert.equal(absent?.city, null);
    assert.deepEqual(absent?.videos, []);
    for (const [a,b] of [[owner,viewer],[viewer,owner]]) {
      await pool.query("INSERT INTO citizen_blocks(blocker_id,blocked_id) VALUES($1,$2)", [a,b]);
      assert.equal(await citizenProjection(owner!, viewer), null);
      await pool.query("DELETE FROM citizen_blocks WHERE blocker_id=$1 AND blocked_id=$2", [a,b]);
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const image = `/api/citizen-profiles/media/${owner}/avatar/00000000-0000-0000-0000-000000000000`;
      await client.query("UPDATE citizen_profiles SET avatar_url=$1 WHERE user_id=$2", [image, owner]);
      await client.query("INSERT INTO citizen_listings(user_id,type,title,description,price) VALUES($1,'market','Test','Disposable',0)", [owner]);
      await deleteAccountCitizenSocial(client, owner!);
      assert.equal((await client.query("SELECT 1 FROM citizen_profiles WHERE user_id=$1", [owner])).rowCount, 0);
      assert.equal((await client.query("SELECT 1 FROM citizen_listings WHERE user_id=$1", [owner])).rowCount, 0);
      const queued = await client.query("SELECT object_name FROM clip_storage_cleanup WHERE clip_id=$1", [-owner!]);
      assert.ok(queued.rows.some(row => row.object_name === citizenMediaReference(image, owner!)));
    } finally {
      await client.query("ROLLBACK"); // No fake objects or outbox rows survive the test.
      client.release();
    }
    if (r2Config()) {
      const key = `citizen-media/${owner}/avatar/${randomUUID()}`;
      const imageUrl = `/api/citizen-profiles/media/${key.slice("citizen-media/".length)}`;
      const config = r2Config()!;
      try {
        await r2Client().send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: Buffer.from("disposable cleanup integration fixture"), ContentType: "application/octet-stream" }));
        await pool.query("UPDATE citizen_profiles SET avatar_url=$1 WHERE user_id=$2", [imageUrl, owner]);
        await pool.query("INSERT INTO clip_storage_cleanup(object_name,clip_id) VALUES($1,$2)", [`r2:${key}`, -owner!]);
        assert.equal(await runClipStorageCleanupBatch(-owner!), 0, "Active profile object must not be removed");
        await r2Client().send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        const erase = await pool.connect();
        try {
          await erase.query("BEGIN");
          await deleteAccountCitizenSocial(erase, owner!);
          await erase.query("COMMIT");
        } catch (error) { await erase.query("ROLLBACK"); throw error; }
        finally { erase.release(); }
        assert.equal(await runClipStorageCleanupBatch(-owner!), 1, "Account-erased media must drain from durable outbox");
        await assert.rejects(r2Client().send(new HeadObjectCommand({ Bucket: config.bucket, Key: key })), (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404);
      } finally {
        await r2Client().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
        await pool.query("DELETE FROM clip_storage_cleanup WHERE object_name=$1", [`r2:${key}`]);
      }
    }
  } finally {
    await pool.query("DELETE FROM citizen_blocks WHERE blocker_id=ANY($1::int[]) OR blocked_id=ANY($1::int[])", [ids]);
    await pool.query("DELETE FROM user_follows WHERE follower_id=ANY($1::int[]) OR following_id=ANY($1::int[])", [ids]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [ids]);
    await pool.end();
  }
});