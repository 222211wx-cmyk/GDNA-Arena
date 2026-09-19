import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const { S3Client, DeleteObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const base = process.env.API_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const db = new Client({ connectionString: process.env.DATABASE_URL });
const users = [], media = [], listingIds = [];
const s3 = new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const bucket = process.env.R2_BUCKET_NAME || process.env.R2_BUCKET;
async function call(path, { cookie, method = "GET", data, form } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(data ? { "content-type": "application/json" } : {}) }, body: form || (data ? JSON.stringify(data) : undefined) });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
async function ok(path, options, status = 200) {
  const r = await call(path, options);
  assert.equal(r.status, status, `${path}: ${JSON.stringify(r.body)}`);
  return r.body;
}
async function update(user, data) { return ok("/citizen-profiles/me", { cookie: user.cookie, method: "PUT", data }); }
async function signup(name, birthDate) {
  const r = await call("/auth/register", { method: "POST", data: { username: name, password: "disposable-citizen-social-2026", birthDate } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const row = (await db.query("SELECT id FROM users WHERE username=$1", [name])).rows[0];
  const user = { id: row.id, name, cookie: r.cookie };
  users.push(user); return user;
}
test("citizen social HTTP integration: persisted privacy, discovery, images, commerce, consent and ages", { timeout: 180000 }, async t => {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(process.env.REPLIT_DEV_DOMAIN);
  await db.connect();
  t.after(async () => {
    const errors = [];
    // Exact recorded keys only; tests never sweep a bucket/prefix.
    for (const url of media) {
      const key = `citizen-media/${url.split("/media/")[1]}`;
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); throw new Error(`Media still exists: ${key}`); }
        catch (error) { if (error.$metadata?.httpStatusCode !== 404) throw error; }
        await db.query("DELETE FROM clip_storage_cleanup WHERE object_name=$1", [`r2:${key}`]);
      } catch (error) { errors.push(error); }
    }
    for (const user of users) {
      try {
        const result = await call("/auth/me", { cookie: user.cookie, method: "DELETE" });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        // Current running build may predate citizen erasure hook; explicitly remove exact fixtures.
        await db.query("DELETE FROM citizen_listings WHERE user_id=$1", [user.id]);
        await db.query("DELETE FROM citizen_profiles WHERE user_id=$1", [user.id]);
        await db.query("DELETE FROM clip_storage_cleanup WHERE clip_id=$1 AND object_name LIKE 'r2:citizen-media/%'", [-user.id]);
        await db.query("DELETE FROM user_follows WHERE follower_id=$1 OR following_id=$1", [user.id]);
        await db.query("DELETE FROM citizen_blocks WHERE blocker_id=$1 OR blocked_id=$1", [user.id]);
      } catch (error) { errors.push(error); }
    }
    await db.end(); s3.destroy();
    assert.deepEqual(errors.map(e => e.message), [], "Cleanup must succeed with no orphan media");
  });
  const suffix = Date.now().toString(36);
  const a = await signup(`csa${suffix}`, "1990-01-01");
  const b = await signup(`csb${suffix}`, "1992-01-01");
  const child = await signup(`csc${suffix}`, `${new Date().getUTCFullYear() - 10}-01-01`);
  await t.test("metadata and auth/input guards", async () => {
    const meta = await ok("/citizen-profiles/meta");
    assert.ok(meta.cities.includes("Rabat")); assert.ok(meta.interests.includes("Music"));
    assert.equal((await call("/citizen-profiles/me")).status, 401);
    assert.equal((await call("/citizen-profiles/me", { cookie:a.cookie, method:"PUT", data:{ birthDate:"1990-01-01" } })).status, 400);
    const bare = await ok(`/citizen-profiles/${a.name}`);
    assert.equal(bare.age, null); assert.equal(bare.city, null);
  });
  await t.test("persistence, fields, mutual friendship, whole-profile privacy", async () => {
    await update(a, { displayName:"Citizen HTTP test", city:"Rabat", interests:["Music","Art"], bio:"private bio", status:"available", visibility:"everyone", fieldVisibility:{ bio:"friends",age:"private" }, mapDiscoverable:true, aiConsent:false });
    assert.equal((await ok("/citizen-profiles/me", { cookie:a.cookie })).bio, "private bio");
    const stranger = await ok(`/citizen-profiles/${a.name}`);
    assert.equal(stranger.bio, null); assert.equal(stranger.age, null);
    assert.equal("phone" in stranger, false); assert.equal("birthDate" in stranger, false);
    await ok(`/citizen-profiles/${a.name}/follow`, { cookie:b.cookie, method:"POST" });
    assert.equal((await ok(`/citizen-profiles/${a.name}`, { cookie:b.cookie })).isFriend, false);
    await ok(`/citizen-profiles/${b.name}/follow`, { cookie:a.cookie, method:"POST" });
    const friend = await ok(`/citizen-profiles/${a.name}`, { cookie:b.cookie });
    assert.equal(friend.isFriend,true); assert.equal(friend.bio,"private bio"); assert.equal(friend.age,null);
    await update(a, { visibility:"private" });
    const hidden = await ok(`/citizen-profiles/${a.name}`, { cookie:b.cookie });
    assert.equal(hidden.city,null); assert.equal(hidden.canMessage,false);
    await update(a, { visibility:"everyone", fieldVisibility:{} });
  });
  await t.test("discovery, map and adult matchmaking filters", async () => {
    let result = await ok("/citizen-profiles?city=Rabat&interest=Music&minAge=18&maxAge=80");
    assert.ok(result.profiles.some(p => p.userId === a.id));
    result = await ok("/citizen-profiles?city=Casablanca");
    assert.ok(!result.profiles.some(p => p.userId === a.id));
    assert.ok((await ok("/citizen-profiles/map")).profiles.some(p=>p.userId===a.id));
    await update(a,{mapDiscoverable:false});
    assert.ok(!(await ok("/citizen-profiles/map")).profiles.some(p=>p.userId===a.id));
    await update(b,{city:"Rabat",interests:["Music"],status:"available",aiConsent:true});
    const matches = await ok("/citizen-profiles?matchmaking=true", {cookie:b.cookie});
    assert.equal(matches.profiles.find(p=>p.userId===a.id)?.compatibility.method,"shared-interests-city-heuristic");
    assert.equal((await call("/citizen-profiles?minAge=no")).status,400);
  });
  await t.test("real avatar/cover upload, protected read, privacy revocation", async () => {
    const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=","base64");
    for(const kind of ["avatar","cover"]) {
      const form=new FormData(); form.append("image",new Blob([png],{type:"image/png"}),`${kind}.png`);
      const result=await ok(`/citizen-profiles/me/media?kind=${kind}`,{cookie:a.cookie,method:"POST",form});
      media.push(result.url);
      const response=await fetch(`${base.replace(/\/api$/,"")}${result.url}`);
      assert.equal(response.status,200); assert.equal(response.headers.get("content-type"),"image/png");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
    }
    await update(a,{fieldVisibility:{avatarUrl:"private",coverUrl:"private"}});
    for(const url of media) {
      assert.equal((await fetch(`${base.replace(/\/api$/,"")}${url}`)).status,404);
      assert.equal((await fetch(`${base.replace(/\/api$/,"")}${url}`,{headers:{cookie:a.cookie}})).status,200);
    }
  });
  await t.test("market and service CRUD with authorized sellers", async () => {
    for(const type of ["market","service"]) {
      const item=await ok("/citizen-listings",{cookie:a.cookie,method:"POST",data:{type,title:`Test ${type}`,description:"Disposable test listing",price:12.5,city:"Rabat"}},201);
      listingIds.push(item.id); assert.equal(item.seller.userId,a.id);
      assert.ok((await ok(`/citizen-listings?type=${type}&city=Rabat`)).listings.some(i=>i.id===item.id));
      assert.equal((await call(`/citizen-listings/${item.id}`,{cookie:b.cookie,method:"DELETE"})).status,404);
    }
  });
  await t.test("assistant consent, unavailable provider only, private context denial", async () => {
    assert.equal((await call("/ai/citizen-assistant",{cookie:a.cookie,method:"POST",data:{section:"profile"}})).status,400);
    assert.equal((await call("/ai/citizen-assistant",{cookie:a.cookie,method:"POST",data:{section:"profile",consent:true}})).status,403);
    assert.equal((await call("/ai/citizen-assistant",{cookie:b.cookie,method:"POST",data:{section:"auto-reply",consent:true}})).status,403);
    // Never invoke a funded provider. Heuristic route requires no provider call.
    const heuristic=await ok("/ai/citizen-assistant",{cookie:b.cookie,method:"POST",data:{section:"matchmaking",consent:true,username:a.name}});
    assert.equal(heuristic.method,"shared-interests-city-heuristic");
    await update(a,{visibility:"private"});
    for(const data of [{section:"profile",username:a.name},{section:"market",listingId:listingIds[0]}]) {
      assert.equal((await call("/ai/citizen-assistant",{cookie:b.cookie,method:"POST",data:{...data,consent:true}})).status,404);
    }
    if (!process.env.OPENAI_API_KEY?.trim()) {
      await new Promise(resolve=>setTimeout(resolve,61000));
      const unavailable=await call("/ai/citizen-assistant",{cookie:b.cookie,method:"POST",data:{section:"profile",consent:true}});
      assert.equal(unavailable.status,503,JSON.stringify(unavailable.body));
      assert.equal(unavailable.body.code,"AI_UNAVAILABLE");
    } else {
      t.diagnostic("Provider has credentials: generation deliberately not invoked (no paid call).");
    }
  });
  await t.test("all-age profiles, minor/unknown DOB availability refusal", async () => {
    assert.equal((await call("/citizen-profiles/me",{cookie:child.cookie,method:"PUT",data:{status:"available"}})).status,403);
    await update(child,{bio:"All ages profile",status:"private"});
    // Legacy accounts can lack DOB; fixture-only SQL models this supported state without overriding any real account.
    await db.query("UPDATE users SET birth_date=NULL WHERE id=$1",[child.id]);
    assert.equal((await ok("/citizen-profiles/me",{cookie:child.cookie})).age,null);
    assert.equal((await call("/citizen-profiles/me",{cookie:child.cookie,method:"PUT",data:{status:"available"}})).status,403);
    assert.equal((await call("/citizen-profiles?matchmaking=true",{cookie:child.cookie})).status,403);
    await ok("/auth/birth-date",{cookie:child.cookie,method:"POST",data:{birthDate:"2016-01-01"}});
  });
  await t.test("owner listing deletion",async()=>{
    for(const id of listingIds) await ok(`/citizen-listings/${id}`,{cookie:a.cookie,method:"DELETE"});
  });
});