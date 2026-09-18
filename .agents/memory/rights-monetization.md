---
name: Rights & Monetization system
description: Content earnings (royalty per view/like), ownership fingerprints, piracy reports — invariants that must not regress.
---

Content monetization spans GlobalStar uploads (earn per view) and Pulse posts (earn per like); rates live in `monetization_settings` and are admin-editable. Pulse earnings join the SAME withdrawable pool as GlobalStar earnings.

Invariants (each closed a real money-farming hole — keep them):
- **Fingerprint claims remain atomic**: upload row + sha256 fingerprint claim commit in one transaction; losing a conflict rolls back the upload and deletes the file. In Clips this is technical duplicate protection, not proof that the first uploader legally owns the work.
- **Frozen means frozen**: confirmed-pirated gs_uploads get `is_frozen=true`; the per-view earnings recompute `(views+1)*rate` must stay CASE-guarded on is_frozen or the pirate's balance silently regenerates.
- **Only authenticated non-self likes earn money**; anonymous/self likes count as likes but credit 0. Like dedupe relies on a unique (post_id, voter_ip) index with voter_ip = `user:<id>` for logged-in users.
- **Why:** engagement identity from client-controlled X-Forwarded-For is forgeable; anything that mints withdrawable coins must key on session identity + DB uniqueness.

Gotcha: `pulse_posts.earnings` was added by raw ALTER; Drizzle silently DROPS unknown keys in `.set()` — earnings updates must be raw SQL, and the column had to be added to the ORM schema for the feed to return it. Same session discovered prod-relevant missing `media_type` column; both ALTERs are in the rights DDL bootstrap.

Ordinary citizens may register and publish without royal verification. Payout verification is separate from a declared original-work deposit.

**Why:** The owner explicitly separated producer monetization controls from ordinary citizen creativity. On 2026-09-18 they clarified that originals are registered to their rightful owners or authorized producers, not automatically to the uploading account.

**How to apply:** Distinguish the submitting account from the named rights holder/producer. Store declarations and their chronology without claiming that a user-supplied registration reference has been legally verified. Preserve historical fingerprints and financial protections.

For Clips, music overlap alone must not reject a citizen's video. Full-video matching requires both matching duration and visual sequence; audio exact-file duplicate protection is distinct from recognizing songs across re-encodings.

**Why:** The owner explicitly allows citizens' music-backed stories while protecting complete originals. Conservative matching avoids treating shared music, static backgrounds, or a similar runtime as proof of copying.

**How to apply:** Keep technical permission separate from legal licensing. Do not claim that shortening or changing imagery grants copyright permission, or that a declared deposit proves legal ownership. The video minimum does not apply to short audio.
