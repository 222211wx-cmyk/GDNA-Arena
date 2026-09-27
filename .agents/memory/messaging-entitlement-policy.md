---
name: Manual messaging subscriptions
description: Administrator-controlled citizen send access, separate from calling and vendor subscriptions.
---

A new citizen receives ten lifetime free messages. After those messages, an
administrator must manually activate sending. The server is authoritative; a
client boolean is not proof of entitlement. Reading history remains free and
calling remains independent. Quotas do not reset on deletion, logout or device change.

**Why:** The owner explicitly requested subscription-gated message sending and
selected manual administrator activation rather than Stripe. Vendor subscriptions
(EAS, hosting, Firebase) do not confer citizen messaging access. This supersedes
unlimited free message-sending policy, not the existing free-call policy. The
owner subsequently explicitly granted the first ten messages and requested
the exhausted-trial text “Contactez l'AMIS pour activer”.

**How to apply:** Provide enable/revoke administration and server-side send checks,
not just a disabled button. Do not introduce Stripe or gate calls without a
separate instruction. Preserve existing messages when access is revoked.