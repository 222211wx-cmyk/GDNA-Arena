---
name: Session persistence & login normalization
description: Why sessions must be in Postgres and identities normalized — root cause of "login 20 times a day" complaints
---
- Sessions live in a `user_sessions` Postgres table (connect-pg-simple). **Why:** in-memory sessions were wiped on every republish/restart, logging out every citizen — the owner's biggest production complaint.
- `createTableIfMissing` of connect-pg-simple is broken in the bundled (esbuild) prod build — it reads `table.sql` from disk. The table is created manually at startup in app.ts. Keep it that way.
- Emails are trimmed+lowercased on register AND login; lookups use `LOWER()`; unique functional indexes `users_email_lower_uniq` / `users_username_lower_uniq` exist in the DB (insert 23505 → 409). **Why:** case/whitespace-sensitive matching made correct credentials fail, forcing users to re-register.
- Sessions are `rolling: true` with a per-login "remember me" override: cookie maxAge 30d when `rememberMe === true`, else 7d (owner fixed 30d). **Why:** Netflix-style stay-logged-in was an explicit owner request; strict `=== true` avoids silently granting 90d to callers omitting the flag.
- Login/register regenerate the session ID after credential verification (anti session-fixation), login errors are one generic bilingual AR/FR message (anti account-enumeration), and production refuses to start without `SESSION_SECRET` (no forgeable fallback).
- Twilio/SMS/WhatsApp/2FA is PERMANENTLY BANNED by the owner (Aug 2026 final decision) — never propose or add any such code. Login stays email + password + remember-me only.
- **How to apply:** any new auth-adjacent code must normalize identifiers the same way, never store sessions in memory, regenerate sessions on privilege change, and keep auth errors non-enumerating.
