---
name: Clips upload transport decisions
description: Owner-directed Clips compression and resumable upload policy, plus integrity constraints
---

Keep the default citizen Clips upload lightweight. Optional, bounded client compression is now allowed; do not make whole-file hashing, full media decoding, or a large WASM download mandatory.

**Why:** After rejecting browser compression on 2026-09-18 because of Android hangs, the owner explicitly requested client compression again on 2026-09-19, then specifically requested ffmpeg.wasm. This supersedes the prohibition and the interim MediaRecorder approach; browser encoding can still increase total waiting time.

**How to apply:** Lazy-load optional compression, retain the selected original, label preparation separately from transfer, and reject larger or unverifiable outputs without silently uploading the original. Keep cancellation, bounded metadata waits, foreground-only capture, resumable chunks, and server-side duration verification. Never promise a universal sub-minute transfer from duration alone.

Treat browser duration as an untrusted hint, not a prerequisite for an enabled Publish button.

**Why:** The owner reported a selected 137 MB file with R2 Connected but an inert button. A browser unable to decode metadata must not silently block a server-verifiable upload.

**How to apply:** Keep selection actionable; validate visibly on click and let unknown metadata reach authoritative server probing. Cancellation must cover pending metadata as well as preparation and transfer.

Explicitly bundle the FFmpeg class worker rather than relying on its default relative URL under Vite dependency optimization.

**Why:** The default worker resolved beside the optimized dependency instead of the package and returned 404; UI compression stalled until its loading timeout.

**How to apply:** Keep worker/core/WASM same-origin and base-path-aware. Verify the actual worker endpoint and a real browser encode, not just TypeScript or successful imports.

Validate packaged-WASM ffprobe output, not its return code alone.

**Why:** The real FFmpeg core 0.12.10 produced complete, valid JSON with a `-1` return value. Treating that value as a definitive failure blocked compression before encoding, despite a valid source.

**How to apply:** Require a fresh non-empty probe report and strictly validate its streams/duration. Missing or invalid reports still fail; keep the exit status for diagnostics. Verify this behavior again on core upgrades.

Always retain a chosen audio/video file and show its name/size immediately. The latest upload specification allows files through 2 GiB with duration at least 60 seconds; apply no upper duration cap.

**Why:** The owner's later architecture specification on 2026-09-18 explicitly replaced unrestricted size with a 2 GB maximum and requested 5 MB Tus chunks. The intended interaction remains file → duration → generated name/code, without the old 25 MiB restriction or short-audio exception.

**How to apply:** No publication-type/rights/footage declarations. Enforce only the requested 2 GiB file maximum, preserve selection on failure/cancellation, enforce duration again on the server, and show “خاص دقيقة الفوق” for short files.

All new clips still undergo server transcoding; video targets at most 720p, while audio uses AAC. Optional client compression does not replace server validation.

**Why:** The later architecture specification superseded the earlier above-100-MiB-only rule. Transcoding does not reduce the original upload transfer, and no transfer can progress at zero bandwidth.

**How to apply:** Keep large transfers resumable and processing durable with bounded concurrency. Do not promise that server compression makes uploading the original faster, that audio has a video resolution, or that an Autoscale instance will stay alive for a long background encode.

Scope upload retry identities to the exact selected File object unless full content identity is safely established.

**Why:** Matching names, sizes, modification dates and a small beginning/end sample cannot distinguish files whose middle bytes differ. Reusing an upload offset across those files can splice unrelated bytes.

**How to apply:** Keep same-selection network recovery and retries without claiming persistence across reloads. Do not substitute partial fingerprints for full-file identity in durable resume logic.

If maintaining legacy Tus APIs, parallelize independent resumable parts, not concurrent writes at different offsets of one Tus upload.

**Why:** A Tus upload has one authoritative sequential offset. The official GCS Tus store evaluated in September 2026 did not support concatenation or termination. Keeping the existing storage provider while supporting parallel transfer and cancellation required separately resumable parts and durable server-side composition.

**How to apply:** Preserve server ownership checks, atomic offset updates and exact ordered composition when changing upload transport. Do not enable a client's built-in parallel-concatenation mode unless the server actually implements that extension.

Use direct R2 multipart transfer for web publishing without implicitly migrating historical clips.

**Why:** The owner authorized using the existing R2 bucket for new uploads after confirming access, not moving or deleting existing Replit-stored media. Mixed storage is intentional during this transition.

**How to apply:** Resolve playback, processing, thumbnails, and deletion from each object's provider identity, not the currently selected upload provider. Never retag historical object names to make them appear to be R2 objects. Future native publishing should use the same direct-upload protocol.

Treat verified S3 access and a Replit Cloudflare connector as separate connection states.

**Why:** R2 credentials successfully authenticated without completing the earlier connector prompt. The originally requested bucket name did not exist; the owner explicitly selected the existing bucket instead.

**How to apply:** Base the app's Connected indicator on a real bucket-access check. Do not reopen OAuth just to change a connector chip, or assume that saved credentials prove the selected bucket exists.
