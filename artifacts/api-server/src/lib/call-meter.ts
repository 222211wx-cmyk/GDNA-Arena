export interface MediaInterruptionState {
  interruptedMs: number;
  disconnectedAt: number | null;
}

export interface MediaContinuitySample {
  bothFresh: boolean;
  interruptionUsedMs: number;
  exhausted: boolean;
}

/**
 * Accounts paused wall time cumulatively. Recovery closes the current paused
 * interval but never replenishes its budget, so heartbeat flapping cannot create
 * unlimited unbilled media time.
 */
export function sampleMediaContinuity(
  state: MediaInterruptionState,
  now: number,
  callerConnectedAt: number | null,
  calleeConnectedAt: number | null,
  freshnessMs: number,
  interruptionBudgetMs: number,
): MediaContinuitySample {
  const bothFresh = callerConnectedAt !== null &&
    calleeConnectedAt !== null &&
    now - callerConnectedAt <= freshnessMs &&
    now - calleeConnectedAt <= freshnessMs;

  if (bothFresh) {
    if (state.disconnectedAt !== null) {
      state.interruptedMs += Math.max(0, now - state.disconnectedAt);
      state.disconnectedAt = null;
    }
  } else if (state.disconnectedAt === null) {
    // For an expired heartbeat, begin at its actual freshness deadline rather
    // than this sampling tick. Explicit false reports use `now` because their
    // participant timestamp is null.
    const expiryCandidates = [callerConnectedAt, calleeConnectedAt]
      .filter((value): value is number => value !== null)
      .map(value => value + freshnessMs);
    state.disconnectedAt = callerConnectedAt === null || calleeConnectedAt === null
      ? now
      : Math.min(now, ...expiryCandidates);
  }

  const interruptionUsedMs = state.interruptedMs +
    (state.disconnectedAt === null ? 0 : Math.max(0, now - state.disconnectedAt));
  return {
    bothFresh,
    interruptionUsedMs,
    exhausted: interruptionUsedMs >= interruptionBudgetMs,
  };
}
