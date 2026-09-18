---
name: Approved orphan deletion fencing
description: Why reviewed orphan cleanup reserves names permanently and is separate from ordinary clip deletion
---

Reviewed orphan cleanup must preserve durable name tombstones even after successful deletion, rejection, or expired authorization. Keep its signed, generation-pinned queue separate from the ordinary clip-deletion outbox.

**Why:** A storage request can finish after a timeout or database acknowledgement failure. Generation preconditions protect replacement bytes, but alone cannot prevent a publication transaction from claiming the same approved generation before a delayed delete finishes. Durable database publication guards close that gap.

**How to apply:** Never purge tombstones or bypass publication guards as a routine cleanup step. Keep ownership/key provisioning an explicit, quiesced operator operation; deploying the application must not itself authorize any orphan deletion. Reauthorization may refresh approval expiry, not change an existing tombstone's exact object identity.