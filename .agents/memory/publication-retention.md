---
name: Publication retention
description: Owner-requested lifetime policy for published Clips and social posts.
---

Published Helixly/Clips and social posts must not expire automatically by age. Authors control deletion through a confirmed action; moderation and existing administrative safety controls remain available.

**Why:** The owner explicitly selected “remain until their owner deletes them” for both Clips and social posts, rather than a longer fixed expiration period.

**How to apply:** Preserve old published content in feed queries and maintenance jobs. Do not confuse temporary signed playback links, incomplete upload cleanup, or explicitly ephemeral stories with published-post retention. Keep deletion ownership checks on the server, not only in the interface.