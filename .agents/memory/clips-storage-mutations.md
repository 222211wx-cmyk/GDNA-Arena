---
name: Resumable storage mutation quotas
description: Object-store per-object mutation throttling in long, fast Clips uploads
---

Respect object storage's per-object mutation quota when updating resumable session manifests. Exempting authenticated chunks from the API's request quota does not remove this independent storage limit.

**Why:** A real 105 MiB upload failed even though smaller uploads passed: successive updates to the same session metadata object triggered provider 429 responses. The browser's short generic retry loop could not make the operation reliable.

**How to apply:** Handle throttling at the storage mutation boundary while preserving compare-and-swap generations and offset ownership. Never convert a stale generation into an unconditional overwrite. Test a sequence of many chunks, not just a single create/PATCH/complete.

For R2 cleanup, compare listing and HEAD modification times at whole-second precision while also pinning the exact ETag and byte count.

**Why:** R2 listings return millisecond timestamps, but HEAD's HTTP Last-Modified loses milliseconds. Exact timestamp-string comparison rejects unchanged objects.

**How to apply:** Retain conditional deletion with the pinned ETag; timestamp normalization must never replace identity or reference checks.