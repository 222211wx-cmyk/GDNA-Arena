---
name: Clips storage provider policy
description: Owner rejected a Firebase Storage migration.
---

Keep Clips on its existing storage providers; do not migrate uploads or historical media to Firebase Storage.

**Why:** On 2026-10-04 the owner explicitly rejected Firebase Storage because of its reported prepayment requirement and requested fixing playback without a provider migration.

**How to apply:** Fix delivery, MIME types, controls and hit testing independently of storage migration. Preserve existing object references and media. Do not present Firebase setup as a prerequisite to playback.