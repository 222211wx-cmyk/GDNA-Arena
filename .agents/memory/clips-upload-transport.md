---
name: Clips upload transport decisions
description: Owner-directed simplification of the Clips flow and constraints for legacy resumable uploads
---

Keep the citizen Clips page and uploader simple; do not reintroduce browser FFmpeg, virtualization, or the parallel Tus client without a new request.

**Why:** On 2026-09-18 the owner explicitly rejected that complexity after reporting mobile browser failures and uploads stuck at 0%. They requested native video controls and direct original-file uploads capped at 20 MB.

**How to apply:** Preserve this product decision when improving Clips. The existing storage provider, server-side duration checks, and ownership protections remain required. Legacy resumable APIs can remain for compatibility but must not drive the new page.

Treat the historical one-minute minimum as a video rule, not a restriction on newly supported audio uploads.

**Why:** The subsequent request expanded Clips to social-style audio and video sharing, including fast news reporting. Requiring every audio recording to last a minute would exclude ordinary short spoken reports; short audio is deliberately supported while the owner's explicit video minimum is preserved.

**How to apply:** Determine the actual media kind on the server rather than trusting an uploaded MIME label. A short video disguised as audio must not bypass the video rule.

If maintaining legacy Tus APIs, parallelize independent resumable parts, not concurrent writes at different offsets of one Tus upload.

**Why:** A Tus upload has one authoritative sequential offset. The official GCS Tus store evaluated in September 2026 did not support concatenation or termination. Keeping the existing storage provider while supporting parallel transfer and cancellation required separately resumable parts and durable server-side composition.

**How to apply:** Preserve server ownership checks, atomic offset updates and exact ordered composition when changing upload transport. Do not enable a client's built-in parallel-concatenation mode unless the server actually implements that extension.

Fingerprint the bytes the server receives and publishes, not an alleged original-file hash sent by the browser.

**Why:** Browser compression changes the file. The server cannot authenticate a client-supplied pre-compression hash without receiving that original; trusting it would let uploaders make false first-owner claims.

**How to apply:** Keep ownership enforcement tied to the server-calculated digest of the composed media. Thumbnails never establish ownership.