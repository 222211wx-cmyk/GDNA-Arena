---
name: Browser media verification
description: Why successful uploads do not prove that browser-compressed media retains its audio and timing
---

Check the actual encoded output when changing browser media preparation; upload success and a playable container are not sufficient evidence.

**Why:** Native recording can accept a video while omitting an audio track captured before playback starts. Browser audio routing can also change recorded timing. Generic MP4 support does not guarantee H.264/AAC: workspace Chromium produced VP9/Opus in an MP4 container.

**How to apply:** Inspect output audio/video tracks, non-silent audio, dimensions, duration and native playback. Treat MIME type as a container label, not a codec compatibility guarantee. Preserve already-passing transport checks and use a short targeted media sample for encoder fixes rather than repeating long uploads.