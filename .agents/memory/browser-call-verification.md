---
name: Browser call verification
description: Cross-route acceptance coverage and real browser push test constraints
---

- Verify global incoming calls with a fresh recipient who has never opened Communications or Messages.
  **Why:** testing both peers inside Messages masked device registration failures even though the provider was already mounted globally.
  **How to apply:** receive on Home and Profile, and answer from Arena; provider placement alone is not acceptance evidence.

- Use a regular persistent browser profile for real Web Push verification, not an isolated incognito browser context.
  **Why:** Chromium's private contexts rejected PushManager registration even when the test harness granted Notification permission. This looked like missing platform support.
  **How to apply:** distinguish notification permission, a browser subscription, an authenticated server binding, and delivery of the exact current call's notification. None proves the next.

- Match notifications by the current call ID, not by any notification or an empty global notification list.
  **Why:** unrelated or earlier OS notifications can produce false success or false cleanup failures.
  **How to apply:** check the exact call's incoming card appears and disappears; avoid logging private endpoints or subscription keys.