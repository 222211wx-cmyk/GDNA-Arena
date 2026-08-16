---
name: Empire CLIPS rules
description: Owner-mandated publishing rules for the Reels-style clips tab
---

- Clips minimum duration is **2:00 — inverted from usual reels**: short clips are REJECTED, there is NO maximum (owner explicitly allows 25h+). **Why:** owner's "شرط المنتج" — clips are producer works, not shorts. **How to apply:** never "optimize" by capping length or lowering the minimum.
- Only the rights-owner may publish: every clip file is sha256-fingerprinted into the shared `content_fingerprints` first-owner registry (content_type 'clip'); duplicates are rejected naming the original owner.
- Owner clarification: ORIGINAL recordings belong to their owner only; a citizen's OWN phone/camera recording of something IS allowed to publish, provided it is not the same "chrono" as the original (i.e. not an exact copy). The sha256 exact-copy block implements this — do NOT add duration-equality rejection (false positives).
- Duration is client-reported (server can't probe video metadata); server enforces the reported value — accepted limitation, noted to owner.
- Clip media lives in App Storage under `PRIVATE_OBJECT_DIR/clips/` (streamed via multer→GCS with inline sha256, no disk/memory buffering); view earnings ride monetization_settings and roll into the PPO revenue pool.
- View minting: identity from proxy-derived `req.ip` only (trust proxy 1), dedupe + earnings update in one transaction — raw X-Forwarded-For was review-rejected as forgeable.
