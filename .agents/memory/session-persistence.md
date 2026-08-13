---
name: Session persistence & login normalization
description: Why sessions must be in Postgres and identities normalized — root cause of "login 20 times a day" complaints
---
- Sessions live in a `user_sessions` Postgres table (connect-pg-simple). **Why:** in-memory sessions were wiped on every republish/restart, logging out every citizen — the owner's biggest production complaint.
- `createTableIfMissing` of connect-pg-simple is broken in the bundled (esbuild) prod build — it reads `table.sql` from disk. The table is created manually at startup in app.ts. Keep it that way.
- Emails are trimmed+lowercased on register AND login; lookups use `LOWER()`; unique functional indexes `users_email_lower_uniq` / `users_username_lower_uniq` exist in the DB (insert 23505 → 409). **Why:** case/whitespace-sensitive matching made correct credentials fail, forcing users to re-register.
- **How to apply:** any new auth-adjacent code must normalize identifiers the same way and never store sessions in memory.
