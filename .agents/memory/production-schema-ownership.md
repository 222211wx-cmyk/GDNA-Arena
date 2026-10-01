---
name: Production schema ownership
description: Why application migrations must not replay during artifact deployment startup.
---

Replit Publish owns development-to-production schema application for this project. Do not replay the Drizzle application migration history during production process startup.

**Why:** Publish may already create a new schema column before promotion while the production Drizzle journal still considers its migration unapplied. Replaying it then fails with a duplicate-column error and prevents the API health check from opening.

**How to apply:** Keep local development migrations available, but let Publish manage the production schema before promotion. Production startup should initialize services and verify tables without replaying the application migration journal.

Do not assume Drizzle's table filter makes a partial-schema push safe for unrelated database objects.

**Why:** In this workspace, a Clips-only push preview proposed dropping dozens of unrelated serial sequences despite filtering the tables. Forcing that preview would threaten other sections; a reviewed additive update was necessary.

**How to apply:** Review every proposed statement, including sequences and constraints, before applying schema changes. Preserve existing names and historical SQL. Never use `--force` to bypass unexplained DROP statements.

Committed schema declarations and SQL files do not prove the development database was updated. Check its actual columns before concluding that another Publish will fix a missing production column.

**Why:** Both databases can match each other while both lag behind the deployed code; in that case Publish computes no schema changes and the same authentication failure persists.

**How to apply:** Review and apply narrowly additive development changes first, then inspect the development-to-production diff for removals. Publish copies schema, not migration data backfills; usage counters also need a safe monotonic application-level reconciliation.