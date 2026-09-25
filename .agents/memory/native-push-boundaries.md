---
name: Native push delivery boundaries
description: Provider identity and acceptance criteria for native mobile notification work.
---

Keep Expo push tokens distinct from direct FCM tokens and browser Web Push subscriptions; do not send one provider's token through another provider.

**Why:** The existing browser/direct-FCM infrastructure does not deliver to Expo tokens. Extending the mobile app must preserve existing notification channels rather than repurpose their credentials or storage.

**How to apply:** Bind opt-in to the authenticated account/session. Distinguish registration, provider acceptance, real device delivery and native incoming-call UI. Passing exports or showing a settings switch proves none of the latter. Ordinary notification taps must never auto-answer. Native locked-screen calling needs separate CallKit/Android Telecom work and real-device verification.