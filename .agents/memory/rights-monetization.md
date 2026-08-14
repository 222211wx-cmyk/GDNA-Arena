---
name: Rights & Monetization system
description: Content earnings (royalty per view/like), ownership fingerprints, piracy reports — invariants that must not regress.
---

Content monetization spans GlobalStar uploads (earn per view) and Pulse posts (earn per like); rates live in `monetization_settings` and are admin-editable. Pulse earnings join the SAME withdrawable pool as GlobalStar earnings.

Invariants (each closed a real money-farming hole — keep them):
- **First owner wins, atomically**: upload row + sha256 fingerprint claim commit in one transaction; losing a fingerprint conflict rolls back the upload and deletes the file.
- **Frozen means frozen**: confirmed-pirated gs_uploads get `is_frozen=true`; the per-view earnings recompute `(views+1)*rate` must stay CASE-guarded on is_frozen or the pirate's balance silently regenerates.
- **Only authenticated non-self likes earn money**; anonymous/self likes count as likes but credit 0. Like dedupe relies on a unique (post_id, voter_ip) index with voter_ip = `user:<id>` for logged-in users.
- **Why:** engagement identity from client-controlled X-Forwarded-For is forgeable; anything that mints withdrawable coins must key on session identity + DB uniqueness.

Gotcha: `pulse_posts.earnings` was added by raw ALTER; Drizzle silently DROPS unknown keys in `.set()` — earnings updates must be raw SQL, and the column had to be added to the ORM schema for the feed to return it. Same session discovered prod-relevant missing `media_type` column; both ALTERs are in the rights DDL bootstrap.
