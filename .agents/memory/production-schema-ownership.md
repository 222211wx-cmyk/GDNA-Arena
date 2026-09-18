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