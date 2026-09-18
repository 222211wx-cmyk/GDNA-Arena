---
name: Clip media probing
description: Distinguish normal seek-related HTTP disconnects from storage failures.
---

For a loopback HTTP range bridge feeding ffprobe/ffmpeg, client-side ECONNRESET and EPIPE can be normal when the decoder seeks or exits before consuming the response. Cancel that response's source download, but do not treat those client errors alone as proof that the video is invalid. GCS source errors must still fail verification.

**Why:** Real MP4, MOV, and WebM probes reset partially consumed HTTP responses during otherwise successful verification. Treating every socket error as fatal rejects valid uploads.

**How to apply:** Keep client disconnect handling separate from upstream storage error handling in any shared or refactored media bridge; retain real-format seek and early-exit fixtures.