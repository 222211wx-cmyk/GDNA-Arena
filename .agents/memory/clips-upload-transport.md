---
name: Clips server-managed resumable upload policy
description: Browser chunks through our server into S3; no product-defined total-size or duration ceilings
---

Clips must use browser chunks → our server → S3. Server handles the storage transfer. Preserve original bytes, durable resume identity, and retry after network interruptions.

**Why:** On 2026-10-03 the owner explicitly replaced the earlier browser-to-S3 single-PUT architecture and repeatedly prohibited adding file-size, duration, or product upload restrictions without explicit permission.

**How to apply:** The owner's final Life-Path specification explicitly reinstated a 60-second minimum. No application-defined maximum file size or maximum duration. Distinguish operational chunk sizing, authentication and byte-integrity checks from product restrictions. Never promise physically infinite provider resources.

Preserve published media and mixed storage identities.

**Why:** Transport changes do not authorize deletion, movement or reclassification of historical publications.

**How to apply:** Keep provider-aware playback and deletion, encryption boundaries, ownership checks, immutable publication identities and careful abandoned-upload reconciliation.

Storage protection scope is only six-hour orphan cleanup and verified server-side compression for originals above 200,000,000 bytes. Do not introduce per-user storage warnings, capacity-percentage checks, or automatic archival transitions.

**Why:** On 2026-10-03 the owner explicitly withdrew the previously requested storage warning and archival features as a mistake.

**How to apply:** The compression condition governs server processing, never acceptance of uploads. Do not claim the scheduled cleanup or post-verification source removal exists until actually implemented.

Keep the citizen-facing upload experience open; handle storage organization and maintenance on the server.

**Why:** The owner reiterated in Darija that the system should stay open like social platforms and that the server should handle its own management.

**How to apply:** Do not turn server maintenance into new upload restrictions. This does not authorize removing authentication, ownership checks, or byte-integrity verification.

Assess core Clips publishing readiness separately from unfinished storage-maintenance features. Do not repeatedly reopen the earnings interface or invent additional publishing conditions.

**Why:** The owner explicitly objected to repeated publishing blockers around scheduled orphan cleanup and said the earnings interface subject was finished.

**How to apply:** Report actual upload, publication and playback failures with evidence, separately from unfinished enhancements. Do not infer that this objection authorizes unsafe deletion, cancels every earlier requirement, or proves the current release works.

The owner identifies the original destination as Helixly.app/klips, belonging to GDNA Arena, and wants existing users preserved rather than a separate new site.

**Why:** The owner clarified the intended original site after confusion between the storage name and the published app.

**How to apply:** Treat this as the requested destination, not proof of a live deployment or database association. Reverify publishing metadata and the public site before confirming deployment identity.