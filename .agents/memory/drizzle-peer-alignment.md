---
name: Drizzle optional peer alignment
description: Firebase Admin can change optional peer resolution and split Drizzle type identities.
---

Keep Drizzle's optional peer resolutions consistent between the database library and API server.

**Why:** installing Firebase Admin brought OpenTelemetry into the API dependency graph, creating two same-version Drizzle instances whose private/protected types were incompatible across packages.

**How to apply:** after database-related dependency changes, compare the resolved peer suffixes in TypeScript errors before changing application queries or adding type casts. Align optional peer versions across consumers and rebuild shared declarations.