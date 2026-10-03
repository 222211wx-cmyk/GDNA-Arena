---
name: Clips server-managed resumable upload policy
description: Browser chunks through our server into S3; no product-defined total-size or duration ceilings
---

Clips must use browser chunks → our server → S3. Server handles the storage transfer. Preserve original bytes, durable resume identity, and retry after network interruptions.

**Why:** On 2026-10-03 the owner explicitly replaced the earlier browser-to-S3 single-PUT architecture and repeatedly prohibited adding file-size, duration, or product upload restrictions without explicit permission.

**How to apply:** No application-defined maximum file size, minimum duration, or maximum duration. Treat storage growth as a capacity-planning problem rather than inventing a product cap. Distinguish operational chunk sizing, authentication and byte-integrity checks from product restrictions. Never promise physically infinite provider resources.

Preserve published media and mixed storage identities.

**Why:** Transport changes do not authorize deletion, movement or reclassification of historical publications.

**How to apply:** Keep provider-aware playback and deletion, encryption boundaries, ownership checks, immutable publication identities and careful abandoned-upload reconciliation.