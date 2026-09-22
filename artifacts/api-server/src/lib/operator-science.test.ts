import test from "node:test";
import assert from "node:assert/strict";
import { OPERATOR_PACKS, parseOperatorMeasurement, parseOperatorReferral, parsePartnerContact, operatorAggregateThreshold } from "../../../../lib/operator-partnership.js";
import { estimateAvoidedBytes, observedRequestSuccessScore, predictMediaSize } from "../../../../lib/gdna-data-science.js";

const eventId = "8180bd1f-5882-4da7-abce-65b554132b99";
test("aggregate privacy gates each contributor subgroup, never request count", () => {
  assert.equal(operatorAggregateThreshold(0, 0), false);
  assert.equal(operatorAggregateThreshold(9, 0), false);
  assert.equal(operatorAggregateThreshold(1, 1000), false);
  assert.equal(operatorAggregateThreshold(10, 0), true);
  assert.equal(operatorAggregateThreshold(0, 10), true);
  assert.equal(operatorAggregateThreshold(10, 10), true);
  assert.equal(operatorAggregateThreshold(-1, 20), false);
});
test("operator prices and dial codes stay explicitly unverified", () => {
  assert.deepEqual(OPERATOR_PACKS.map(p => p.priceMad), [20, 29, 25]);
  for (const pack of OPERATOR_PACKS) {
    assert.equal(pack.priceStatus, "unverified");
    assert.equal(pack.dialCodeVerified, false);
    assert.equal(pack.partnershipStatus, "not_signed");
    assert.match(pack.officialUrl, /^https:\/\/(inwi|orange|iam)\.ma$/);
  }
});
test("strict bounded reports never accept arbitrary savings or identity", () => {
  const sample = { eventId, surface: "lite", outcome: "cache", observedBytes: 0 };
  assert.equal(parseOperatorMeasurement(sample).observedBytes, 0);
  for (const extra of [{ originalBytes: 123 }, { alternativeBytes: 1 }, { userId: 1 }, { url: "https://example.com" }]) {
    assert.throws(() => parseOperatorMeasurement({ ...sample, ...extra }));
  }
  for (const n of [-1, 52_428_801, NaN, 0.5]) assert.throws(() => parseOperatorMeasurement({ ...sample, observedBytes: n }));
  assert.throws(() => parseOperatorMeasurement({ ...sample, eventId: "bad" }));
  assert.throws(() => parseOperatorMeasurement({ ...sample, clipId: 2, surface: "chat" }));
  assert.equal(parseOperatorReferral({ eventId, source: "star6" }).source, "star6");
  assert.throws(() => parseOperatorReferral({ eventId, source: "facebook" }));
});
test("contact consent, bounds and honeypot are required", () => {
  const contact = { company: "Real company", contactEmail: "contact@example.org", message: "Please discuss a partnership", consent: true };
  assert.equal(parsePartnerContact(contact).company, "Real company");
  assert.throws(() => parsePartnerContact({ ...contact, consent: false }));
  assert.throws(() => parsePartnerContact({ ...contact, website: "spam" }));
  assert.throws(() => parsePartnerContact({ ...contact, message: "a".repeat(3001) }));
});
test("observed resilience is not uptime; no samples is null", () => {
  assert.equal(observedRequestSuccessScore(0, 0, 0), null);
  assert.equal(observedRequestSuccessScore(2, 1, 4), 0.75);
  assert.throws(() => observedRequestSuccessScore(2, 1, 2));
  assert.equal(estimateAvoidedBytes(15000000, 2200000, "success"), 12800000);
  assert.equal(estimateAvoidedBytes(15000000, 2200000, "failure"), 0);
  assert.equal(estimateAvoidedBytes(15000000, 2200000, "cache"), 0);
  assert.equal(estimateAvoidedBytes(100, 200, "success"), 0);
});
test("15MB local prediction varies with dimensions and duration", () => {
  const sample = { originalBytes: 15000000, durationSec: 60, width: 1920, height: 1080 };
  const a = predictMediaSize(sample), b = predictMediaSize({ ...sample, targetWidth: 1280, targetHeight: 720 });
  assert.notEqual(a.estimatedBytes, 1200000);
  assert.ok(a.estimatedBytes < b.estimatedBytes);
  assert.notEqual(a.estimatedBytes, predictMediaSize({ ...sample, durationSec: 120 }).estimatedBytes);
  assert.equal(a.qualityGuaranteed, false);
  assert.equal(predictMediaSize({ ...sample, targetWidth: 1920, targetHeight: 1080 }).estimatedAvoidedBytes, 0);
  assert.throws(() => predictMediaSize({ ...sample, durationSec: 0 }));
});