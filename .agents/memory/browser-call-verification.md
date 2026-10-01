---
name: Browser call verification
description: Cross-route acceptance coverage and real browser push test constraints
---

- Preserve `/messages` as the messenger entry, but receive calls across the entire website, not only inside that page. Do not add a new product tab or substitute a native application.
  **Why:** On 2026-10-01 the owner clarified that the immediate problem is in-app reception on Market/Arena and other pages, not FCM waking a closed phone.
  **How to apply:** Keep authenticated call signaling and incoming UI independent of the selected page and optional push permissions. Cover alternate lightweight shells, not just the main router. Respect browser audio activation requirements without adding unsolicited setup banners.

- Verify global incoming calls with a fresh recipient who has never opened Communications or Messages.
  **Why:** testing both peers inside Messages masked device registration failures even though the provider was already mounted globally.
  **How to apply:** receive on Home and Profile, and answer from Arena; provider placement alone is not acceptance evidence.

- Use a regular persistent browser profile for real Web Push verification, not an isolated incognito browser context.
  **Why:** Chromium's private contexts rejected PushManager registration even when the test harness granted Notification permission. This looked like missing platform support.
  **How to apply:** distinguish notification permission, a browser subscription, an authenticated server binding, and delivery of the exact current call's notification. None proves the next.

- Match notifications by the current call ID, not by any notification or an empty global notification list.
  **Why:** unrelated or earlier OS notifications can produce false success or false cleanup failures.
  **How to apply:** check the exact call's incoming card appears and disappears; avoid logging private endpoints or subscription keys.