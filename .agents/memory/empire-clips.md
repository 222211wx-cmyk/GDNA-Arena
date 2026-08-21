---
name: Empire CLIPS rules
description: Owner-mandated publishing rules for the Reels-style clips tab
---

- Clips duration rule (FINAL, owner-confirmed twice): **minimum 1:00, NO maximum** — under 1 min rejected with French message "Durée minimale: 1 minute. Les clips de moins d'1 min sont interdits."; anything ≥1 min publishes "حسب الكرونو". **Why:** rule bounced 2:00/no-max → 1min/24h → 1min/no-max; owner explicitly removed the 24h cap. **How to apply:** rule copy on /clips stays in FRENCH per owner's literal text; never reintroduce a max duration.
- Only the rights-owner may publish: every clip file is sha256-fingerprinted into the shared `content_fingerprints` first-owner registry (content_type 'clip'); duplicates are rejected naming the original owner.
- Owner clarification: ORIGINAL recordings belong to their owner only; a citizen's OWN phone/camera recording of something IS allowed to publish, provided it is not the same "chrono" as the original (i.e. not an exact copy). The sha256 exact-copy block implements this — do NOT add duration-equality rejection (false positives).
- Duration is client-reported (server can't probe video metadata); server enforces the reported value — accepted limitation, noted to owner.
- Clip media lives in App Storage under `PRIVATE_OBJECT_DIR/clips/` (streamed via multer→GCS with inline sha256, no disk/memory buffering); view earnings ride monetization_settings and roll into the PPO revenue pool.
- View minting: identity from proxy-derived `req.ip` only (trust proxy 1), dedupe + earnings update in one transaction — raw X-Forwarded-For was review-rejected as forgeable.
- Deleting a clip removes its App Storage object, clip row, and view records, but **keeps** its SHA-256 fingerprint claim. **Why:** deletion should not let a later uploader seize an original creator's first-owner right. **How to apply:** never delete the related `content_fingerprints` record as part of content deletion.
