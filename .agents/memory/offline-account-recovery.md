---
name: Offline ownership recovery
description: Why recovery material and revocation must remain independent of sign-in and encrypted-history restoration
---

Recovery codes prove account ownership, not possession of the old device's E2EE
private keys. Keep code enrollment an explicit authenticated password-reverified
action, and never use a claimed username as proof or silently replace the code
flow with email/SMS.

**Why:** the lost-device request was deliberately separate from persistent
username/password sign-in; restoring encrypted history without old keys would
misrepresent the encryption boundary.

**How to apply:** retain accounts, quota and ciphertext during recovery. Explain
that codes restore access only and cannot erase offline copies or decrypt old
history. Any future encrypted-key backup needs a separately agreed security design.

Deleting session rows alone is insufficient revocation: stale logins, store writes
and device enrollments can race the reset and recreate access.

**Why:** password verification and session persistence occur at different times,
and provider mirror writes may complete even after their PostgreSQL connection
fails. External provider cleanup also cannot be atomic with local transactions.

**How to apply:** carry the credential generation from the same verified snapshot,
fence writes and live connections against authoritative state, and retain durable
cleanup with provider-side generation fencing. Report pending provider revocation
honestly, independently from completed local session revocation.