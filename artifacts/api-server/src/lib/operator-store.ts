import { pool } from "@workspace/db";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { estimateAvoidedBytes, observedRequestSuccessScore, SCIENCE_METHODOLOGY } from "../../../../lib/gdna-data-science";
import type { parseOperatorMeasurement, parseOperatorReferral, parsePartnerContact } from "../../../../lib/operator-partnership";
import { OPERATOR_SOURCES, operatorAggregateThreshold } from "../../../../lib/operator-partnership";
import { LITE_VISIBILITY } from "./lite-projection";
import { LITE_VIDEO_FIELD } from "./lite-media-policy";

export class OperatorError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const operatorSessionHash = (sessionId: string) => createHash("sha256").update(`operator-session:${sessionId}`).digest("hex");
export async function cleanOperatorRetention() {
  // Bounded frequency, serialized across processes, no startup-time DDL.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query("SELECT pg_try_advisory_xact_lock(71721019) AS acquired");
    if (lock.rows[0].acquired) {
      const gate = await client.query(`INSERT INTO operator_quotas(day,scope,kind,used)
        VALUES(to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'),'retention','cleanup',1)
        ON CONFLICT DO NOTHING RETURNING day`);
      if (gate.rowCount) {
        await client.query("DELETE FROM operator_events WHERE created_at < now()-interval '90 days'");
        await client.query("DELETE FROM operator_attributions WHERE created_at < now()-interval '90 days'");
        await client.query("DELETE FROM operator_quotas WHERE day < to_char((now() AT TIME ZONE 'UTC')-interval '90 days','YYYY-MM-DD')");
        await client.query("DELETE FROM partner_contacts WHERE created_at < now()-interval '180 days'");
        await client.query("DELETE FROM operator_audio_receipts WHERE created_at < now()-interval '1 day'");
      }
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
async function quota(client: PoolClient, scope: string, kind: string, limit: number) {
  const result = await client.query(`INSERT INTO operator_quotas(day,scope,kind,used)
    VALUES(to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'),$1,$2,1)
    ON CONFLICT(day,scope,kind) DO UPDATE SET used=operator_quotas.used+1
    WHERE operator_quotas.used<$3 RETURNING used`, [scope, kind, limit]);
  if (!result.rowCount) throw new OperatorError(429, "Daily submission limit reached");
}
async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
  catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
/** Only called after a complete, server-verified audio response finishes sending. */
export async function recordAudioDelivery(sessionId: string, clipId: number, sourceObject: string, deliveredBytes: number) {
  return transaction(async client => {
    const { rows: [r] } = await client.query(`SELECT c.size_bytes FROM clips c
      JOIN clip_lite_media l ON l.clip_id=c.id AND l.kind='audio'
      WHERE c.id=$1 AND c.object_name=$2 AND NOT c.is_frozen
      AND (c.upload_object_name IS NULL OR c.upload_object_name=c.object_name)
      AND l.state='ready' AND l.source_object=$2 AND l.size_bytes=$3`, [clipId, sourceObject, deliveredBytes]);
    if (!r || !Number.isSafeInteger(Number(r.size_bytes)) || Number(r.size_bytes) <= 0) return;
    const scope = operatorSessionHash(sessionId);
    await quota(client, scope, "audio_receipt", 1000);
    await client.query(`INSERT INTO operator_audio_receipts(id,session_hash,clip_id,original_bytes,alternative_bytes)
      VALUES($1,$2,$3,$4,$5)`, [randomUUID(), scope, clipId, r.size_bytes, deliveredBytes]);
  });
}
export async function recordOperatorEvent(sessionHash: string, userId: number | null,
  input: ReturnType<typeof parseOperatorMeasurement> | ReturnType<typeof parseOperatorReferral>) {
  return transaction(async client => {
    const kind = "source" in input ? "referral" : "measure";
    const inserted = await client.query(`INSERT INTO operator_events(day,session_hash,kind,event_id,user_id)
      VALUES(to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'),$1,$2,$3,$4)
      ON CONFLICT DO NOTHING RETURNING day`, [sessionHash, kind, input.eventId, userId]);
    if (!inserted.rowCount) return { accepted: true, duplicate: true };
    await quota(client, sessionHash, kind, kind === "measure" ? 1000 : 20);
    if ("source" in input) {
      await client.query(`INSERT INTO operator_attributions(session_hash,source,user_id) VALUES($1,$2,$3)
        ON CONFLICT(session_hash) DO UPDATE SET user_id=COALESCE(operator_attributions.user_id,EXCLUDED.user_id)`, [sessionHash, input.source, userId]);
    } else {
      let avoided = 0, comparison = false;
      if (input.clipId !== undefined) {
        const result = await client.query(`SELECT c.id
          FROM clips c JOIN users u ON u.id=c.user_id LEFT JOIN citizen_profiles p ON p.user_id=u.id
          WHERE ${LITE_VISIBILITY} AND ${LITE_VIDEO_FIELD} AND c.is_frozen=FALSE AND c.id=$2`, [userId, input.clipId]);
        if (!result.rowCount) throw new OperatorError(404, "Clip unavailable");
        // Predictive clicks, list requests, cache and failures cannot claim savings.
        // A receipt is one-use and tied to this cookie session and exact audio size.
        if (input.outcome === "success") {
          const receipt = await client.query(`DELETE FROM operator_audio_receipts WHERE id=(
            SELECT id FROM operator_audio_receipts WHERE session_hash=$1 AND clip_id=$2
              AND alternative_bytes=$3 AND created_at>now()-interval '1 day'
            ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
            RETURNING original_bytes,alternative_bytes`, [sessionHash, input.clipId, input.observedBytes]);
          if (receipt.rowCount) {
            comparison = true;
            avoided = estimateAvoidedBytes(Number(receipt.rows[0].original_bytes), Number(receipt.rows[0].alternative_bytes), "success");
          }
        }
      }
      await client.query(`UPDATE operator_events SET surface=$5,outcome=$6,observed_bytes=$7,avoided_bytes=$8,comparison=$9
        WHERE day=$1 AND session_hash=$2 AND kind=$3 AND event_id=$4`,
      [inserted.rows[0].day, sessionHash, kind, input.eventId, input.surface, input.outcome, input.observedBytes, avoided, comparison]);
      if (userId) await client.query("UPDATE operator_attributions SET user_id=COALESCE(user_id,$2) WHERE session_hash=$1", [sessionHash, userId]);
    }
    return { accepted: true, duplicate: false };
  });
}
export async function citizenScience(userId: number) {
  const { rows: [r] } = await pool.query(`SELECT count(*)::int AS samples,
    count(*) FILTER(WHERE outcome='success')::int AS successes,count(*) FILTER(WHERE outcome='cache')::int AS cached,
    count(*) FILTER(WHERE comparison)::int AS comparisons,COALESCE(sum(observed_bytes),0)::text AS bytes,
    COALESCE(sum(avoided_bytes),0)::text AS avoided FROM operator_events WHERE user_id=$1 AND kind='measure'
    AND day>=to_char(date_trunc('month',now() AT TIME ZONE 'UTC'),'YYYY-MM-DD')`, [userId]);
  return { month: new Date().toISOString().slice(0, 7), measuredPayloadBytes: Number(r.bytes),
    estimatedAvoidedBytes: Number(r.avoided), observedRequestSuccessScore: observedRequestSuccessScore(r.successes, r.cached, r.samples),
    sampleSize: r.samples, comparisonSampleSize: r.comparisons, measurementStatus: "client-reported-not-verified", methodology: SCIENCE_METHODOLOGY };
}
export async function partnerStats(admin = false) {
  const { rows } = await pool.query(`SELECT source,
    count(DISTINCT user_id)::int AS "authenticatedCitizens",
    count(*) FILTER(WHERE user_id IS NULL)::int AS "anonymousReferrals"
    FROM operator_attributions WHERE created_at>=now()-interval '30 days' GROUP BY source ORDER BY source`);
  // Totals deduplicate a citizen attributed in more than one cookie session/source.
  const { rows: [total] } = await pool.query(`SELECT count(DISTINCT user_id)::int AS "authenticatedCitizens",
    count(*) FILTER(WHERE user_id IS NULL)::int AS "anonymousReferrals"
    FROM operator_attributions WHERE created_at>=now()-interval '30 days'`);
  const suppressed = !operatorAggregateThreshold(total.authenticatedCitizens, total.anonymousReferrals);
  // Aggregate events separately from visitor counts: joining raw events onto
  // attribution counts would multiply visitors. Only post-attribution samples
  // contribute to a source, never retroactively assign earlier browsing.
  const sourceSamples = await pool.query(`SELECT a.source,count(*)::int AS samples,
    count(*) FILTER(WHERE e.outcome='success')::int AS successes,
    count(*) FILTER(WHERE e.outcome='cache')::int AS cached,
    count(*) FILTER(WHERE e.comparison)::int AS comparisons,
    COALESCE(sum(e.observed_bytes),0)::text AS bytes,COALESCE(sum(e.avoided_bytes),0)::text AS avoided
    FROM operator_events e JOIN operator_attributions a ON a.session_hash=e.session_hash
    WHERE e.kind='measure' AND e.created_at>=now()-interval '30 days'
      AND a.created_at>=now()-interval '30 days' AND e.created_at>=a.created_at
    GROUP BY a.source`);
  const { rows: [globalSamples] } = await pool.query(`SELECT count(*)::int AS samples,
    count(*) FILTER(WHERE outcome='success')::int AS successes,
    count(*) FILTER(WHERE outcome='cache')::int AS cached,
    count(*) FILTER(WHERE comparison)::int AS comparisons,
    COALESCE(sum(observed_bytes),0)::text AS bytes,COALESCE(sum(avoided_bytes),0)::text AS avoided,
    count(DISTINCT user_id)::int AS citizens,
    count(DISTINCT session_hash) FILTER(WHERE user_id IS NULL)::int AS anonymous
    FROM operator_events WHERE kind='measure' AND created_at>=now()-interval '30 days'`);
  const samplesSuppressed = suppressed || !operatorAggregateThreshold(globalSamples.citizens, globalSamples.anonymous);
  const metricLabels = { measurementStatus: "client-reported-not-verified",
    comparisonBaseline: "same_clip_original", scienceMethodology: SCIENCE_METHODOLOGY };
  function metrics(sample: Record<string, any> | undefined, hidden = false) {
    const r = sample ?? { samples: 0, successes: 0, cached: 0, comparisons: 0, bytes: 0, avoided: 0 };
    return { measuredPayloadBytes: hidden ? null : Number(r.bytes),
      estimatedAvoidedBytes: hidden ? null : Number(r.avoided),
      sampleSize: hidden ? null : r.samples, comparisonSampleSize: hidden ? null : r.comparisons,
      observedRequestSuccessScore: hidden ? null : observedRequestSuccessScore(r.successes, r.cached, r.samples),
      ...metricLabels };
  }
  const base = { period: "last_30_days", privacyThreshold: 10, suppressed: admin ? false : suppressed,
    authenticatedCitizens: !admin && suppressed ? null : total.authenticatedCitizens,
    anonymousReferrals: !admin && suppressed ? null : total.anonymousReferrals,
    ...metrics(globalSamples, !admin && samplesSuppressed),
    scienceSuppressed: !admin && samplesSuppressed,
    methodology: "Distinct authenticated citizen IDs and anonymous cookie sessions with a first-source referral. Anonymous sessions are not verified people. Not sales, operator subscribers, or pack verification." };
  if (!admin) return base;
  const inquiries = await pool.query(`SELECT id,company,contact_email AS "contactEmail",message,consent,created_at AS "createdAt"
    FROM partner_contacts WHERE created_at>=now()-interval '180 days' ORDER BY created_at DESC,id DESC LIMIT 100`);
  const sources = OPERATOR_SOURCES.map(source => ({
    source, authenticatedCitizens: rows.find(r => r.source === source)?.authenticatedCitizens ?? 0,
    anonymousReferrals: rows.find(r => r.source === source)?.anonymousReferrals ?? 0,
    ...metrics(sourceSamples.rows.find(r => r.source === source)),
    period: "last_30_days",
    attributionMethodology: "Same-session measurements at or after first-source attribution within the last 30 days; source is immutable, not an operator-performance claim.",
  }));
  return { ...base, sources, inquiries: inquiries.rows };
}
export async function recordPartnerContact(sessionHash: string, ipHash: string, input: ReturnType<typeof parsePartnerContact>) {
  return transaction(async client => {
    await quota(client, sessionHash, "contact", 3);
    await quota(client, ipHash, "contact_ip", 10);
    await client.query("INSERT INTO partner_contacts(company,contact_email,message,consent) VALUES($1,$2,$3,true)", [input.company, input.contactEmail, input.message]);
    return { received: true, emailSent: false };
  });
}