---
name: Clips upload transport decisions
description: Owner-directed Clips compression and resumable upload policy, plus integrity constraints
---

Use bounded browser video compression before resumable R2 transfer when supported; target 480p at 800 kbps while preserving audio. Retain an explicit original-upload/server-processing fallback for unsupported browsers.

**Why:** On 2026-09-21 the owner explicitly reversed the original-only policy and requested browser compression to reduce transfer size. Earlier reports of mobile stalls still require cancellable preparation and truthful unsupported-browser handling.

**How to apply:** Avoid large encoder downloads on cold routes. Verify real audio, duration, and transformed-file resume identity. Measure preparation separately from transfer and server processing; do not promise universally sub-minute completion.

Treat browser duration as an untrusted hint, not a prerequisite for an enabled Publish button.

**Why:** The owner reported a selected 137 MB file with R2 Connected but an inert button. A browser unable to decode metadata must not silently block a server-verifiable upload.

**How to apply:** Keep selection actionable; validate visibly on click and let unknown metadata reach authoritative server probing. Cancellation must cover pending metadata as well as preparation and transfer.

Browser-close continuation is best effort, not a universal browser guarantee.

**Why:** The owner requested Background Sync after losing a long transfer, but mobile browsers can terminate workers and do not all support Background Sync.

**How to apply:** Persist the original file and upload identity when storage permits; reconcile acknowledged parts on resume. Distinguish background availability from durable reopen-and-resume. If local storage fails, explain the foreground-only limitation rather than claiming saved recovery.

Always retain a chosen audio/video file and show its name/size immediately. The latest upload specification allows files through 10 GiB with duration at least 60 seconds; apply no upper duration cap.

**Why:** The owner's service-separation request on 2026-09-19 explicitly requires the same direct-upload flow for 137 MB and 10 GB files, superseding the earlier 2 GiB cap. The intended interaction remains file → duration → generated name/code, without the old 25 MiB restriction or short-audio exception.

**How to apply:** No publication-type/rights/footage declarations. Enforce the 10 GiB file maximum consistently, preserve selection on failure/cancellation, enforce duration again on the server, and show “خاص دقيقة الفوق” for short files. Do not remove unrelated chat attachment limits.

All new clips still undergo server transcoding; video targets at most 480p at 800 kbps, while audio uses AAC. Keep the historical `_720p.mp4` reserved-object suffix unchanged: it is a storage identity contract, not a current-resolution promise.

**Why:** The later architecture specification superseded the earlier above-100-MiB-only rule. Transcoding does not reduce the original upload transfer, and no transfer can progress at zero bandwidth.

**How to apply:** Keep large transfers resumable and processing durable with bounded concurrency. Do not promise that server compression makes uploading the original faster, that audio has a video resolution, or that an Autoscale instance will stay alive for a long background encode.

Keep new-upload HTTP handling separate from media probing and encoding, and distinguish process separation from independently scaled infrastructure.

**Why:** The owner explicitly requested a lightweight site and a separate queued media worker. Replit documentation confirms that services within one project share its deployment container; another process in that project is not independent compute or evidence of billion-upload capacity.

**How to apply:** Queue heavy work durably after R2 completion and return an accepted/processing state, not a false publication receipt. Make worker execution separately deployable, preserve lightweight homepage/search loading, and disclose when dedicated worker infrastructure and load testing are still required.

Scope upload retry identities to the exact selected File object unless full content identity is safely established.

**Why:** Matching names, sizes, modification dates and a small beginning/end sample cannot distinguish files whose middle bytes differ. Reusing an upload offset across those files can splice unrelated bytes.

**How to apply:** Resume from a persisted original Blob or otherwise establish full content identity. Do not substitute name/size/date or partial fingerprints for full-file identity in durable resume logic. When neither is available, a newly selected file needs a new upload identity.

If maintaining legacy Tus APIs, parallelize independent resumable parts, not concurrent writes at different offsets of one Tus upload.

**Why:** A Tus upload has one authoritative sequential offset. The official GCS Tus store evaluated in September 2026 did not support concatenation or termination. Keeping the existing storage provider while supporting parallel transfer and cancellation required separately resumable parts and durable server-side composition.

**How to apply:** Preserve server ownership checks, atomic offset updates and exact ordered composition when changing upload transport. Do not enable a client's built-in parallel-concatenation mode unless the server actually implements that extension.

Use direct R2 multipart transfer for web publishing without implicitly migrating historical clips.

**Why:** The owner authorized using the existing R2 bucket for new uploads after confirming access, not moving or deleting existing Replit-stored media. Mixed storage is intentional during this transition.

**How to apply:** Resolve playback, processing, thumbnails, and deletion from each object's provider identity, not the currently selected upload provider. Never retag historical object names to make them appear to be R2 objects. Future native publishing should use the same direct-upload protocol.

Treat verified S3 access and a Replit Cloudflare connector as separate connection states.

**Why:** R2 credentials successfully authenticated without completing the earlier connector prompt. The originally requested bucket name did not exist; the owner explicitly selected the existing bucket instead.

**How to apply:** Base the app's Connected indicator on a real bucket-access check. Do not reopen OAuth just to change a connector chip, or assume that saved credentials prove the selected bucket exists.
