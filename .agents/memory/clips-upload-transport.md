---
name: Clips direct original upload policy
description: Owner reversal of compression and persistent upload queues; historical storage safety
---

New web Clips upload the original file with a single cancellable PUT, without browser compression, persistent upload queues, background resume or transcoding before publication. Do not restore the 480p/800kbps preparation or processing-retry UI.

**Why:** On 2026-10-03 the owner explicitly replaced compression and resumability after repeated stalled uploads, requesting direct presign → PUT → confirm and no storage diagnostics in the composer.

**How to apply:** Keep actual byte progress, cancellation and in-memory retry. Closing the page loses transfer state. Single PUT has a smaller provider ceiling than the old 10 GiB multipart path; do not claim the old capacity. Never delete messenger encryption keys or unrelated stored preferences to remove Clips upload persistence.

Unknown browser duration must not block publishing; retain authoritative server validation of valid media at least 60 seconds.

**Why:** Mobile browsers cannot always decode metadata from otherwise valid uploads.

**How to apply:** Permit unknown metadata through server validation; keep selected file on failure. Media validation is not transcoding.

Preserve historical files and mixed storage.

**Why:** The owner authorized changing new uploads, not moving, retagging or deleting published media.

**How to apply:** Resolve historical playback, thumbnails and deletion by stored provider identity. Keep authentication, ownership and immutable-object protections on all direct upload capabilities.