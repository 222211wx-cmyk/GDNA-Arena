---
name: Session persistence & login normalization
description: Why sessions must be in Postgres and identities normalized — root cause of "login 20 times a day" complaints
---
- Sessions live in a `user_sessions` Postgres table (connect-pg-simple). **Why:** in-memory sessions were wiped on every republish/restart, logging out every citizen — the owner's biggest production complaint.
- `createTableIfMissing` of connect-pg-simple is broken in the bundled (esbuild) prod build — it reads `table.sql` from disk. The table is created manually at startup in app.ts. Keep it that way.
- Emails are trimmed+lowercased on register AND login; lookups use `LOWER()`; unique functional indexes `users_email_lower_uniq` / `users_username_lower_uniq` exist in the DB (insert 23505 → 409). **Why:** case/whitespace-sensitive matching made correct credentials fail, forcing users to re-register.
- Sessions are `rolling: true`; remember-me / post-verification / post-reset sessions get 365d maxAge (effectively unlimited with rolling), plain logins 7d. **Why:** the owner explicitly ordered "logged in with no time limit until logout" (Aug 2026) — do not shorten it back.
- Password reset (email code) deletes ALL of the user's rows from `user_sessions` before establishing the new session. **Why:** a stolen session must not survive a password reset.
- Login/register regenerate the session ID after credential verification (anti session-fixation), login errors are one generic bilingual AR/FR message (anti account-enumeration), and production refuses to start without `SESSION_SECRET` (no forgeable fallback).
- Twilio/SMS/WhatsApp/2FA is PERMANENTLY BANNED by the owner (Aug 2026 final decision) — never propose or add any such code. Verification is EMAIL-ONLY, once at registration.
- One-time email verification: 6-digit bcrypt-hashed code, 10min TTL, atomic attempt reservation (max 5), resend 60s cooldown + 5/15min IP limit, verify under auth limiter. `verificationActive()` gates the whole flow: with no mail provider wired in `lib/mailer.ts` (`isMailerConfigured()` false), production skips verification entirely so citizens are never locked out; dev uses a log fallback. **Why:** an unsendable code must never block registration.
- api-server tsconfig uses TS project references to lib/db — after changing lib/db schema, run `npx tsc -b lib/db` or api-server typecheck sees stale types from `lib/db/dist/*.d.ts`.
- **How to apply:** any new auth-adjacent code must normalize identifiers the same way, never store sessions in memory, regenerate sessions on privilege change, and keep auth errors non-enumerating.
