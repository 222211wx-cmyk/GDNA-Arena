---
name: Clips upload transport decisions
description: Owner-directed Clips compression and resumable upload policy, plus integrity constraints
---

Keep the citizen Clips page simple, but permit browser video compression and resumable upload.

**Why:** On 2026-09-18 the owner's subsequent emergency request explicitly superseded the earlier direct-upload-only decision: reduce large videos to 480p at approximately 800 kbps and upload in 1 MiB chunks with retry/resume. This is authorization for compression and resumability, not for deleting the original.

**How to apply:** Preserve the selected source file and create a derivative. Distinguish preparation progress from transferred bytes and committed publication. Retain native playback, existing storage, server-side media verification, and legacy upload compatibility. Do not promise a fixed output size or universal browser codec support.

Treat the historical one-minute minimum as a video rule, not a restriction on newly supported audio uploads.

**Why:** The subsequent request expanded Clips to social-style audio and video sharing, including fast news reporting. Requiring every audio recording to last a minute would exclude ordinary short spoken reports; short audio is deliberately supported while the owner's explicit video minimum is preserved.

**How to apply:** Determine the actual media kind on the server rather than trusting an uploaded MIME label. A short video disguised as audio must not bypass the video rule.

If maintaining legacy Tus APIs, parallelize independent resumable parts, not concurrent writes at different offsets of one Tus upload.

**Why:** A Tus upload has one authoritative sequential offset. The official GCS Tus store evaluated in September 2026 did not support concatenation or termination. Keeping the existing storage provider while supporting parallel transfer and cancellation required separately resumable parts and durable server-side composition.

**How to apply:** Preserve server ownership checks, atomic offset updates and exact ordered composition when changing upload transport. Do not enable a client's built-in parallel-concatenation mode unless the server actually implements that extension.

Fingerprint the bytes the server receives and publishes, not an alleged original-file hash sent by the browser.

**Why:** Browser compression changes the file. The server cannot authenticate a client-supplied pre-compression hash without receiving that original; trusting it would let uploaders make false first-owner claims.

**How to apply:** Keep ownership enforcement tied to the server-calculated digest of the composed media. Thumbnails never establish ownership.