import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import type { Request, Response } from "express";
import { recordOperatorEvent, recordPartnerContact, citizenScience, partnerStats, operatorSessionHash, recordAudioDelivery } from "./operator-store";
import { operatorAdmin } from "../routes/operators";
import { gdnaAuth } from "../routes/gdna";

after(() => pool.end());
const dev = Boolean(process.env.DATABASE_URL) && process.env.NODE_ENV !== "production" && !process.env.REPLIT_DEPLOYMENT;

test("durable concurrent dedupe, first-source attribution, quotas, privacy and admin gates", { skip: !dev }, async () => {
  const suffix = randomUUID(), scope = operatorSessionHash(suffix), anonScope = operatorSessionHash(`${suffix}-anonymous`);
  const company = `operator-test-${suffix}`;
  const ids = (await pool.query(`INSERT INTO users(username,email,password_hash,is_admin)
    VALUES($1,$2,'test',false),($3,$4,'test',true) RETURNING id`,
  [`operator_${suffix}`, `${suffix}@example.test`, `operator_admin_${suffix}`, `admin-${suffix}@example.test`])).rows.map(r => r.id);
  const [citizen, admin] = ids;
  try {
    const id = randomUUID();
    const results = await Promise.all(Array.from({ length: 12 }, () => recordOperatorEvent(scope, citizen, { eventId: id, source: "inwi" })));
    assert.equal(results.filter(r => !r.duplicate).length, 1);
    await recordOperatorEvent(scope, citizen, { eventId: randomUUID(), source: "orange" });
    assert.equal((await pool.query("SELECT source FROM operator_attributions WHERE session_hash=$1", [scope])).rows[0].source, "inwi");
    await recordOperatorEvent(anonScope, null, { eventId: randomUUID(), source: "star6" });
    assert.equal((await pool.query("SELECT user_id FROM operator_attributions WHERE session_hash=$1", [anonScope])).rows[0].user_id, null);
    const initialScience = await citizenScience(citizen);
    assert.equal(initialScience.sampleSize, 0);
    assert.equal(initialScience.observedRequestSuccessScore, null);
    await pool.query(`INSERT INTO operator_quotas(day,scope,kind,used)
      VALUES(to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'),$1,'measure',999)`, [scope]);
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => recordOperatorEvent(scope, citizen,
      { eventId: randomUUID(), surface: "lite", outcome: "success", observedBytes: 100, clipId: undefined })));
    assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(attempts.filter(r => r.status === "rejected" && r.reason.status === 429).length, 11);
    assert.equal((await citizenScience(citizen)).measuredPayloadBytes, 100);
    assert.equal((await citizenScience(admin)).sampleSize, 0);
    const publicStats = await partnerStats();
    assert.ok(!("sources" in publicStats));
    assert.ok(!("inquiries" in publicStats));
    assert.ok(!JSON.stringify(publicStats).includes(suffix));
    if (publicStats.suppressed) {
      assert.equal(publicStats.authenticatedCitizens, null);
      assert.equal(publicStats.anonymousReferrals, null);
    }
    if (publicStats.scienceSuppressed) {
      for (const key of ["measuredPayloadBytes", "estimatedAvoidedBytes", "sampleSize", "comparisonSampleSize", "observedRequestSuccessScore"] as const) {
        assert.equal(publicStats[key], null);
      }
    }
    assert.equal(publicStats.measurementStatus, "client-reported-not-verified");
    assert.equal(publicStats.comparisonBaseline, "same_clip_original");
    const contacts = await Promise.allSettled(Array.from({ length: 8 }, () =>
      recordPartnerContact(scope, `ip-${scope}`, { company, contactEmail: `${suffix}@example.test`, message: "A test-only partnership inquiry fixture." })));
    assert.equal(contacts.filter(r => r.status === "fulfilled").length, 3);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM partner_contacts WHERE company=$1", [company])).rows[0].n, 3);
    assert.ok((await partnerStats(true) as { inquiries: Array<{ company: string }> }).inquiries.some(i => i.company === company));
    async function gate(userId: number | undefined, auth = operatorAdmin) {
      let status = 200, next = false;
      const res = { status(code: number) { status = code; return this; }, json() { return this; } };
      await auth({ session: { userId } } as Request, res as unknown as Response, () => { next = true; });
      return { status, next };
    }
    assert.deepEqual(await gate(undefined), { status: 401, next: false });
    assert.deepEqual(await gate(citizen), { status: 403, next: false });
    assert.deepEqual(await gate(admin), { status: 200, next: true });
    assert.deepEqual(await gate(undefined, gdnaAuth), { status: 401, next: false });
    assert.deepEqual(await gate(citizen, gdnaAuth), { status: 200, next: true });
  } finally {
    await pool.query("DELETE FROM operator_events WHERE session_hash=ANY($1::text[])", [[scope, anonScope]]);
    await pool.query("DELETE FROM operator_attributions WHERE session_hash=ANY($1::text[])", [[scope, anonScope]]);
    await pool.query("DELETE FROM operator_quotas WHERE scope=ANY($1::text[])", [[scope, anonScope, `ip-${scope}`]]);
    await pool.query("DELETE FROM partner_contacts WHERE company=$1", [company]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [ids]);
  }
});

test("clip IDs cannot mint savings: full audio receipt, exact size and success required once", { skip: !dev }, async () => {
  const suffix = randomUUID(), scope = operatorSessionHash(suffix), otherScope = operatorSessionHash(`${suffix}-other`);
  const user = (await pool.query("INSERT INTO users(username,email,password_hash) VALUES($1,$2,'test') RETURNING id",
    [`operator_audio_${suffix}`, `${suffix}@example.test`])).rows[0].id;
  let clip: number | undefined;
  try {
    const before = await partnerStats(true);
    assert.ok("sources" in before);
    const beforeSource = before.sources.find(s => s.source === "itissalat")!;
    await recordOperatorEvent(scope, user, { eventId: randomUUID(), source: "itissalat" });
    clip = (await pool.query(`INSERT INTO clips(user_id,username,title,object_name,upload_object_name,content_type,size_bytes,duration_sec)
      VALUES($1,'test','Test-only audio fixture',$2,$2,'video/mp4',15000000,60) RETURNING id`, [user, suffix])).rows[0].id;
    await pool.query(`INSERT INTO clip_lite_media(clip_id,kind,state,source_object,size_bytes,mime)
      VALUES($1,'audio','ready',$2,200000,'audio/mp4')`, [clip, suffix]);
    async function sample(outcome: "success" | "failure" | "cache", observedBytes = 200000, session = scope) {
      return recordOperatorEvent(session, user, { eventId: randomUUID(), surface: "clips", outcome, observedBytes, clipId: clip });
    }
    await sample("success");
    assert.equal((await citizenScience(user)).estimatedAvoidedBytes, 0);
    await recordAudioDelivery(suffix, clip!, suffix, 200000);
    await sample("success", 200000, otherScope);
    assert.equal((await citizenScience(user)).estimatedAvoidedBytes, 0);
    await sample("failure");
    await sample("cache");
    await sample("success", 1);
    assert.equal((await citizenScience(user)).estimatedAvoidedBytes, 0);
    await sample("success");
    assert.equal((await citizenScience(user)).estimatedAvoidedBytes, 14800000);
    assert.equal((await citizenScience(user)).comparisonSampleSize, 1);
    await sample("success");
    assert.equal((await citizenScience(user)).estimatedAvoidedBytes, 14800000);
    await recordAudioDelivery(suffix, clip!, "not-matching-source", 200000);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM operator_audio_receipts WHERE session_hash=$1", [scope])).rows[0].n, 0);
    const s = await citizenScience(user);
    assert.equal(s.sampleSize, 7);
    assert.equal(s.observedRequestSuccessScore, 6 / 7);
    assert.equal(s.measurementStatus, "client-reported-not-verified");
    const afterStats = await partnerStats(true);
    assert.ok("sources" in afterStats);
    const source = afterStats.sources.find(s => s.source === "itissalat")!;
    assert.equal(source.estimatedAvoidedBytes! - beforeSource.estimatedAvoidedBytes!, 14800000);
    assert.equal(source.comparisonSampleSize! - beforeSource.comparisonSampleSize!, 1);
    assert.equal(source.sampleSize! - beforeSource.sampleSize!, 6); // Other session is not attributed.
    assert.equal(source.measuredPayloadBytes! - beforeSource.measuredPayloadBytes!, 1000001);
    assert.equal(source.comparisonBaseline, "same_clip_original");
    assert.equal(source.measurementStatus, "client-reported-not-verified");
  } finally {
    await pool.query("DELETE FROM operator_audio_receipts WHERE session_hash=$1", [scope]);
    await pool.query("DELETE FROM operator_quotas WHERE scope=ANY($1::text[])", [[scope, otherScope]]);
    if (clip) await pool.query("DELETE FROM clips WHERE id=$1", [clip]);
    await pool.query("DELETE FROM users WHERE id=$1", [user]);
  }
});

test("source science excludes pre-attribution and expired events, separates counts from samples", { skip: !dev }, async () => {
  const scope = operatorSessionHash(randomUUID());
  const before = await partnerStats(true);
  assert.ok("sources" in before);
  const baseline = before.sources.find(s => s.source === "orange")!;
  const early = randomUUID(), expired = randomUUID();
  const sample = (eventId: string, outcome: "success" | "failure" | "cache", observedBytes: number) =>
    recordOperatorEvent(scope, null, { eventId, surface: "lite", outcome, observedBytes, clipId: undefined });
  try {
    await sample(early, "success", 999999);
    await recordOperatorEvent(scope, null, { eventId: randomUUID(), source: "orange" });
    await pool.query("UPDATE operator_events SET created_at=now()-interval '1 hour' WHERE session_hash=$1 AND event_id=$2", [scope, early]);
    await sample(expired, "success", 999999);
    await pool.query("UPDATE operator_events SET created_at=now()-interval '31 days' WHERE session_hash=$1 AND event_id=$2", [scope, expired]);
    await sample(randomUUID(), "failure", 0);
    await sample(randomUUID(), "cache", 0);
    await sample(randomUUID(), "success", 80);
    await recordOperatorEvent(scope, null, { eventId: randomUUID(), source: "inwi" }); // Cannot change first source.
    const result = await partnerStats(true);
    assert.ok("sources" in result);
    const source = result.sources.find(s => s.source === "orange")!;
    assert.equal(source.anonymousReferrals - baseline.anonymousReferrals, 1);
    assert.equal(source.sampleSize! - baseline.sampleSize!, 3);
    assert.equal(source.measuredPayloadBytes! - baseline.measuredPayloadBytes!, 80);
    assert.equal(source.estimatedAvoidedBytes! - baseline.estimatedAvoidedBytes!, 0);
    assert.equal(source.comparisonSampleSize! - baseline.comparisonSampleSize!, 0);
    const expectedSuccesses = (baseline.observedRequestSuccessScore ?? 0) * baseline.sampleSize! + 2;
    assert.ok(Math.abs(source.observedRequestSuccessScore! - expectedSuccesses / source.sampleSize!) < 1e-12);
    assert.equal(result.sources.length, 4);
    assert.ok(!JSON.stringify(source).includes(scope));
    assert.ok(source.attributionMethodology.includes("first-source"));
  } finally {
    await pool.query("DELETE FROM operator_events WHERE session_hash=$1", [scope]);
    await pool.query("DELETE FROM operator_attributions WHERE session_hash=$1", [scope]);
    await pool.query("DELETE FROM operator_quotas WHERE scope=$1", [scope]);
  }
});