---
name: Clips upload transport decisions
description: Owner-directed Clips compression and resumable upload policy, plus integrity constraints
---

Keep the citizen Clips page isolated and lightweight: no browser compression, whole-file hashing, or full media decoding. Native container-metadata reading is required for duration.

**Why:** On 2026-09-18 the owner explicitly reversed the earlier 480p compression request after reporting a blank page and indefinite file-selection blocking on Android at 13.7 KB/s with many tabs. The live page also loaded the full application bundle, making even its compressed JavaScript prohibitively slow.

**How to apply:** Do not reintroduce browser MediaRecorder, ffmpeg, audio decoding, or large-file hashing. Retain resumable chunks, playback on demand, and server-side duration verification. Native metadata reading must have cancellation and a visible timeout/error, not an indefinite blocked selection. A multipart request is not chunked merely because storage streams it.

Always retain a chosen audio/video file and show its name/size immediately. The latest upload specification allows files through 2 GiB with duration at least 60 seconds; apply no upper duration cap.

**Why:** The owner's later architecture specification on 2026-09-18 explicitly replaced unrestricted size with a 2 GB maximum and requested 5 MB Tus chunks. The intended interaction remains file → duration → generated name/code, without the old 25 MiB restriction or short-audio exception.

**How to apply:** No publication-type/rights/footage declarations. Enforce only the requested 2 GiB file maximum, preserve selection on failure/cancellation, enforce duration again on the server, and show “خاص دقيقة الفوق” for short files.

All new clips are transcoded on the server; video targets at most 720p, while audio uses AAC. Browser compression remains forbidden.

**Why:** The later architecture specification superseded the earlier above-100-MiB-only rule. Transcoding does not reduce the original upload transfer, and no transfer can progress at zero bandwidth.

**How to apply:** Keep large transfers resumable and processing durable with bounded concurrency. Do not promise that server compression makes uploading the original faster, that audio has a video resolution, or that an Autoscale instance will stay alive for a long background encode.

Scope upload retry identities to the exact selected File object unless full content identity is safely established.

**Why:** Matching names, sizes, modification dates and a small beginning/end sample cannot distinguish files whose middle bytes differ. Reusing an upload offset across those files can splice unrelated bytes.

**How to apply:** Keep same-selection network recovery and retries without claiming persistence across reloads. Do not substitute partial fingerprints for full-file identity in durable resume logic.

If maintaining legacy Tus APIs, parallelize independent resumable parts, not concurrent writes at different offsets of one Tus upload.

**Why:** A Tus upload has one authoritative sequential offset. The official GCS Tus store evaluated in September 2026 did not support concatenation or termination. Keeping the existing storage provider while supporting parallel transfer and cancellation required separately resumable parts and durable server-side composition.

**How to apply:** Preserve server ownership checks, atomic offset updates and exact ordered composition when changing upload transport. Do not enable a client's built-in parallel-concatenation mode unless the server actually implements that extension.
