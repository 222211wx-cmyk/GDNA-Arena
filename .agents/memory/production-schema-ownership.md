---
name: Production schema ownership
description: Why application migrations must not replay during artifact deployment startup.
---

Replit Publish owns development-to-production schema application for this project. Do not replay the Drizzle application migration history during production process startup.

**Why:** Publish may already create a new schema column before promotion while the production Drizzle journal still considers its migration unapplied. Replaying it then fails with a duplicate-column error and prevents the API health check from opening.

**How to apply:** Keep local development migrations available, but let Publish manage the production schema before promotion. Production startup should initialize services and verify tables without replaying the application migration journal.