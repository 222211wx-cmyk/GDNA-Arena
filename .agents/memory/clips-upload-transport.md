---
name: Clips upload transport decisions
description: Owner-directed Clips compression and resumable upload policy, plus integrity constraints
---

Keep the citizen Clips page isolated and lightweight: no browser compression, whole-file hashing, or full media decoding. Native container-metadata reading is required for duration.

**Why:** On 2026-09-18 the owner explicitly reversed the earlier 480p compression request after reporting a blank page and indefinite file-selection blocking on Android at 13.7 KB/s with many tabs. The live page also loaded the full application bundle, making even its compressed JavaScript prohibitively slow.

**How to apply:** Do not reintroduce browser MediaRecorder, ffmpeg, audio decoding, or large-file hashing. Retain resumable chunks, playback on demand, and server-side duration verification. Native metadata reading must have cancellation and a visible timeout/error, not an indefinite blocked selection. A multipart request is not chunked merely because storage streams it.

Always retain a chosen audio/video file and show its name/size immediately. Enable Publish once its detected duration is at least 60 seconds, regardless of file size; apply no upper duration cap.

**Why:** The owner's final specification on 2026-09-18 explicitly superseded both the 25 MiB restriction and the short-audio exception. The intended interaction is simply file → duration → generated name/code.

**How to apply:** No file-size gate or publication-type/rights/footage declarations in the form. Preserve selection on failure/cancellation, enforce the minimum again on the server, and show “خاص دقيقة الفوق” for short files.

Compression belongs on the server only for files over 100 MiB; video targets 720p, while audio uses audio encoding.

**Why:** The owner explicitly requested this in the final simple-publishing specification. It does not reduce the original upload transfer, and no transfer can progress at zero bandwidth.

**How to apply:** Keep large transfers resumable and processing durable. Do not promise that server compression makes uploading the original faster or that audio has a video resolution.

Scope upload retry identities to the exact selected File object unless full content identity is safely established.

**Why:** Matching names, sizes, modification dates and a small beginning/end sample cannot distinguish files whose middle bytes differ. Reusing an upload offset across those files can splice unrelated bytes.

**How to apply:** Keep same-selection network recovery and retries without claiming persistence across reloads. Do not substitute partial fingerprints for full-file identity in durable resume logic.

If maintaining legacy Tus APIs, parallelize independent resumable parts, not concurrent writes at different offsets of one Tus upload.

**Why:** A Tus upload has one authoritative sequential offset. The official GCS Tus store evaluated in September 2026 did not support concatenation or termination. Keeping the existing storage provider while supporting parallel transfer and cancellation required separately resumable parts and durable server-side composition.

**How to apply:** Preserve server ownership checks, atomic offset updates and exact ordered composition when changing upload transport. Do not enable a client's built-in parallel-concatenation mode unless the server actually implements that extension.
