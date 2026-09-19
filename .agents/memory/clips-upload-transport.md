---
name: Clips upload transport decisions
description: Owner-directed Clips compression and resumable upload policy, plus integrity constraints
---

Keep the default citizen Clips upload lightweight. Optional, bounded client compression is now allowed; do not make whole-file hashing, full media decoding, or a large WASM download mandatory.

**Why:** After rejecting browser compression on 2026-09-18 because of Android hangs, the owner explicitly requested client compression again on 2026-09-19. The latest request supersedes the prohibition, but real-time browser recording can increase total waiting time and can enlarge already-compressed videos.

**How to apply:** Lazy-load optional compression, retain the selected original, label preparation separately from transfer, and reject larger or unverifiable outputs without silently uploading the original. Keep cancellation, bounded metadata waits, foreground-only capture, resumable chunks, and server-side duration verification. Never promise a universal sub-minute transfer from duration alone.

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
