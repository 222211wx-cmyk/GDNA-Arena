---
name: Completion merge validation
description: Why a completion check can fail after local checks passed
---

Treat completion-time validation as checking a potentially different, merged
working tree, not necessarily the exact file contents just tested.

**Why:** Concurrent changes can invalidate earlier build results, and a clean
working tree does not establish that the integrated application compiles.

**How to apply:** If completion reports a failure inconsistent with recent checks,
inspect the current file and recent integration history. Repair the merged result
while preserving concurrent work, then rerun only affected checks. Do not assume
the validation is stale or restore an older whole file that could discard another
change.

Isolated mocked route tests cannot establish that the full router parses or
typechecks. Include the actual API entrypoint build when resolving route merges.