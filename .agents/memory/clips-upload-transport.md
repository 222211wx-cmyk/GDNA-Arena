---
name: Clips upload transport decisions
description: Owner-directed Clips compression and resumable upload policy, plus integrity constraints
---

Keep the citizen Clips page isolated and lightweight: upload original files without browser compression or media decoding. The current limit is 25 MiB.

**Why:** On 2026-09-18 the owner explicitly reversed the earlier 480p compression request after reporting a blank page and indefinite file-selection blocking on Android at 13.7 KB/s with many tabs. The live page also loaded the full application bundle, making even its compressed JavaScript prohibitively slow.

**How to apply:** Do not reintroduce MediaRecorder, ffmpeg, audio decoding, or large-file hashing into file selection. Retain 1 MiB resumable network chunks, native playback on demand, server-side media/rights verification, and visible progress that reaches 100% only after publication. A multipart request is not chunked merely because the storage SDK streams it. Do not promise a two-second load without measuring production-built assets at the requested bandwidth.

Scope upload retry identities to the exact selected File object unless full content identity is safely established.

**Why:** Matching names, sizes, modification dates and a small beginning/end sample cannot distinguish files whose middle bytes differ. Reusing an upload offset across those files can splice unrelated bytes.

**How to apply:** Keep same-selection network recovery and retries without claiming persistence across reloads. Do not substitute partial fingerprints for full-file identity in durable resume logic.

Treat the historical one-minute minimum as a video rule, not a restriction on newly supported audio uploads.

**Why:** The subsequent request expanded Clips to social-style audio and video sharing, including fast news reporting. Requiring every audio recording to last a minute would exclude ordinary short spoken reports; short audio is deliberately supported while the owner's explicit video minimum is preserved.

**How to apply:** Determine the actual media kind on the server rather than trusting an uploaded MIME label. A short video disguised as audio must not bypass the video rule.

If maintaining legacy Tus APIs, parallelize independent resumable parts, not concurrent writes at different offsets of one Tus upload.

**Why:** A Tus upload has one authoritative sequential offset. The official GCS Tus store evaluated in September 2026 did not support concatenation or termination. Keeping the existing storage provider while supporting parallel transfer and cancellation required separately resumable parts and durable server-side composition.

**How to apply:** Preserve server ownership checks, atomic offset updates and exact ordered composition when changing upload transport. Do not enable a client's built-in parallel-concatenation mode unless the server actually implements that extension.

Fingerprint the bytes the server receives and publishes, not an alleged original-file hash sent by the browser.

**Why:** Browser compression changes the file. The server cannot authenticate a client-supplied pre-compression hash without receiving that original; trusting it would let uploaders make false first-owner claims.

**How to apply:** Keep ownership enforcement tied to the server-calculated digest of the composed media. Thumbnails never establish ownership.