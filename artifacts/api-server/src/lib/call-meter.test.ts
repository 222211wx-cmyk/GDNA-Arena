import assert from "node:assert/strict";
import test from "node:test";
import { sampleMediaContinuity, type MediaInterruptionState } from "./call-meter.js";

test("brief heartbeat flaps consume one cumulative interruption budget", () => {
  const state: MediaInterruptionState = { interruptedMs: 0, disconnectedAt: null };
  assert.equal(sampleMediaContinuity(state, 0, 0, 0, 6_500, 12_000).bothFresh, true);

  sampleMediaContinuity(state, 1_000, null, 1_000, 6_500, 12_000);
  sampleMediaContinuity(state, 5_000, 5_000, 5_000, 6_500, 12_000);
  assert.equal(state.interruptedMs, 4_000);
  sampleMediaContinuity(state, 6_000, null, 6_000, 6_500, 12_000);
  sampleMediaContinuity(state, 10_000, 10_000, 10_000, 6_500, 12_000);
  sampleMediaContinuity(state, 11_000, null, 11_000, 6_500, 12_000);
  assert.equal(
    sampleMediaContinuity(state, 15_000, 15_000, 15_000, 6_500, 12_000).exhausted,
    true,
  );
});

test("stalled heartbeat begins interruption at the freshness deadline", () => {
  const state: MediaInterruptionState = { interruptedMs: 0, disconnectedAt: null };
  const sample = sampleMediaContinuity(state, 8_000, 0, 1_000, 6_500, 12_000);
  assert.equal(sample.bothFresh, false);
  assert.equal(state.disconnectedAt, 6_500);
  assert.equal(sample.interruptionUsedMs, 1_500);
});
