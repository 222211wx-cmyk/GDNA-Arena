---
name: Browser media verification
description: Output verification, large-upload control-plane checks, and honest upload-speed measurements
---

When native video controls coexist with a custom image-area click toggle, cancel the image click's default action while leaving the native control strip alone.

**Why:** A real Chromium check showed native default handling undoing the custom play action; mocked media tests did not catch it.

**How to apply:** Verify actual pointer input and advancing playback time, not only calls to play(). Distinguish desktop/mobile viewport checks from physical-device or production-media verification.

Check the actual encoded output when changing media processing; upload success and a playable container are not sufficient evidence.

Before treating a headless MP4 playback error as an application regression, test the identical local fixture and exact codec support in that browser.

**Why:** Workspace headless Chromium rejected both a published H.264 file and its unchanged local Blob with `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`; full-file hashes and range responses proved intact transfer, not playback support.

**How to apply:** Record `canPlayType`, the media error, local-fixture behavior and full content integrity separately. Do not claim real-device playback merely because transport passes.

A black player screenshot alone does not establish a broken stream; inspect the actual poster and a later decoded frame before attributing it to rendering.

**Why:** Live Clips returned a fully black thumbnail while the same H.264/AAC video contained valid visible footage later. Browser autoplay restrictions can leave that black initial state waiting for a gesture.

**How to apply:** Separate feed delivery, poster content, decoding and user-initiated playback. Do not claim a poster-timing fix repairs a black source thumbnail, or that a successful range request proves interactive playback.

**Why:** Native recording can accept a video while omitting an audio track captured before playback starts. Browser audio routing can also change recorded timing. Generic MP4 support does not guarantee H.264/AAC: workspace Chromium produced VP9/Opus in an MP4 container.

**How to apply:** Inspect output audio/video tracks, non-silent audio, dimensions, duration and native playback. Treat MIME type as a container label, not a codec compatibility guarantee. Preserve already-passing transport checks and use a short targeted media sample for encoder fixes rather than repeating long uploads.

Do not use development upload benchmarks or individual API response times as evidence of citizen upload speed.

**Why:** Live logs showed successful chunk requests roughly 45–50 seconds apart while each logged application response took under one second. Those application timings did not account for the full interval experienced by the uploader.

**How to apply:** Compare end-to-end client preparation, transfer, and finalization timings with server logs. Confirm the published bundle matches the code being investigated; distinguish observations from unproven device, network, or proxy causes.

Chromium CDP can omit Content-Length for binary uploads; a missing header is not evidence that zero bytes were uploaded.

**Why:** Direct R2 uploads completed and published successfully while a QA script falsely failed its byte-total assertion because requestWillBeSent omitted that header.

**How to apply:** Use server-verified object sizes or content hashes for byte integrity, and sanitized host/method observations for routing. Treat unavailable client byte counts as unknown, and continue independent playback checks rather than discarding the fixture on an instrumentation-only mismatch.

Verify a new queued processing path against the real compressor, not only mocked job dependencies.

**Why:** Worker boundary tests passed while a reserved output identity violated the compressor's existing validation contract, causing repeated retries before encoding began.

**How to apply:** Exercise one real queued publication through output verification and playback. Once transport passes, use a targeted processing check for subsequent encoder fixes, and allow legitimate retry backoff without mistaking it for an active encode.

Validate maximum-size uploads through their metadata path as well as their binary-transfer path.

**Why:** A valid large-file multipart session can still fail at completion when its part manifest exceeds the HTTP framework's default JSON-body limit, even though every media byte goes directly to R2.

**How to apply:** Test a maximum-part-count completion manifest through the actual HTTP parser. Scope any larger metadata allowance to upload-control routes; preserve unrelated request-size protections.