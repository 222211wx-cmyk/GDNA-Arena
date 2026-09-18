---
name: Clips upload transport decisions
description: Why parallel resumable uploads use separate parts on existing storage, and which bytes can establish an ownership claim
---

Parallelize independent resumable parts, not concurrent writes at different offsets of one Tus upload.

**Why:** A Tus upload has one authoritative sequential offset. The official GCS Tus store evaluated in September 2026 did not support concatenation or termination. Keeping the existing storage provider while supporting parallel transfer and cancellation required separately resumable parts and durable server-side composition.

**How to apply:** Preserve server ownership checks, atomic offset updates and exact ordered composition when changing upload transport. Do not enable a client's built-in parallel-concatenation mode unless the server actually implements that extension.

Fingerprint the bytes the server receives and publishes, not an alleged original-file hash sent by the browser.

**Why:** Browser compression changes the file. The server cannot authenticate a client-supplied pre-compression hash without receiving that original; trusting it would let uploaders make false first-owner claims.

**How to apply:** Keep ownership enforcement tied to the server-calculated digest of the composed media. Thumbnails never establish ownership.