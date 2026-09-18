---
name: Completion merge validation
description: Why a completion check can fail after local checks passed
---

Treat completion-time validation as checking a potentially different, merged
working tree, not necessarily the exact file contents just tested.

**Why:** Concurrent clip-route changes were integrated during completion. Earlier
local tests and the API build passed, but the merged file contained interleaved
handler fragments and failed compilation. The completion callback also committed
that state, leaving a clean working tree despite the new failures.

**How to apply:** If completion reports a failure inconsistent with recent checks,
inspect the current file and recent integration history. Repair the merged result
while preserving concurrent work, then rerun only affected checks. Do not assume
the validation is stale or restore an older whole file that could discard another
change.