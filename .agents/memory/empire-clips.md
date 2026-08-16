---
name: Empire CLIPS rules
description: Owner-mandated publishing rules for the Reels-style clips tab
---

- Clips duration rule (owner-revised): **minimum 1:00, maximum 24h** — short clips REJECTED with French message "Durée minimale: 1 minute...", over-24h rejected "Durée maximale: 24 heures.". **Why:** owner first ordered min 2:00/no max, then revised to 1min/24h with exact French copy. **How to apply:** clip rule copy on /clips is in FRENCH per owner's literal text; don't translate or "fix" the header's "Pas de limite maximale" wording even though backend caps at 24h — it's his exact requested string.
- Only the rights-owner may publish: every clip file is sha256-fingerprinted into the shared `content_fingerprints` first-owner registry (content_type 'clip'); duplicates are rejected naming the original owner.
- Owner clarification: ORIGINAL recordings belong to their owner only; a citizen's OWN phone/camera recording of something IS allowed to publish, provided it is not the same "chrono" as the original (i.e. not an exact copy). The sha256 exact-copy block implements this — do NOT add duration-equality rejection (false positives).
- Duration is client-reported (server can't probe video metadata); server enforces the reported value — accepted limitation, noted to owner.
- Clip media lives in App Storage under `PRIVATE_OBJECT_DIR/clips/` (streamed via multer→GCS with inline sha256, no disk/memory buffering); view earnings ride monetization_settings and roll into the PPO revenue pool.
- View minting: identity from proxy-derived `req.ip` only (trust proxy 1), dedupe + earnings update in one transaction — raw X-Forwarded-For was review-rejected as forgeable.
