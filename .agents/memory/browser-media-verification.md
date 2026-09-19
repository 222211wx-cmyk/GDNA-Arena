---
name: Browser media verification
description: Why successful uploads do not prove that browser-compressed media retains its audio and timing
---

Check the actual encoded output when changing browser media preparation; upload success and a playable container are not sufficient evidence.

**Why:** Native recording can accept a video while omitting an audio track captured before playback starts. Browser audio routing can also change recorded timing. Generic MP4 support does not guarantee H.264/AAC: workspace Chromium produced VP9/Opus in an MP4 container.

**How to apply:** Inspect output audio/video tracks, non-silent audio, dimensions, duration and native playback. Treat MIME type as a container label, not a codec compatibility guarantee. Preserve already-passing transport checks and use a short targeted media sample for encoder fixes rather than repeating long uploads.

Do not use development upload benchmarks or individual API response times as evidence of citizen upload speed.

**Why:** Live logs showed successful chunk requests roughly 45–50 seconds apart while each logged application response took under one second. Those application timings did not account for the full interval experienced by the uploader.

**How to apply:** Compare end-to-end client preparation, transfer, and finalization timings with server logs. Confirm the published bundle matches the code being investigated; distinguish observations from unproven device, network, or proxy causes.

Chromium CDP can omit Content-Length for binary uploads; a missing header is not evidence that zero bytes were uploaded.

**Why:** Direct R2 uploads completed and published successfully while a QA script falsely failed its byte-total assertion because requestWillBeSent omitted that header.

**How to apply:** Use server-verified object sizes or content hashes for byte integrity, and sanitized host/method observations for routing. Treat unavailable client byte counts as unknown, and continue independent playback checks rather than discarding the fixture on an instrumentation-only mismatch.