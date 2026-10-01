---
name: Messaging access without subscription quotas
description: Owner removed the ten-message limit and activation requirement; preserve historical records and safety checks.
---

Message sending must not depend on a ten-message lifetime quota or manual
subscription activation. This applies to the messaging system, not to unrelated
platform permissions or financial entitlements. Reading history and calling
remain independent.

**Why:** On 2026-10-01 the owner explicitly ordered removal of the ten-message
quota and restoration of messaging access, superseding the earlier free-trial
and administrator-activation policy. Scope was messaging only, with the
underlying accounts and other platform sections preserved.

**How to apply:** Remove the sending gate and activation prompts, not authentication,
room membership, blocking, moderation, or abuse rate limits. Preserve historical
subscription flags, counters, messages and audit records rather than granting
every account a paid subscription or deleting financial data. Do not reintroduce
Stripe or a calling quota.