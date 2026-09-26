---
name: Native push delivery boundaries
description: Provider identity and acceptance criteria for native mobile notification work.
---

Keep Expo push tokens distinct from direct FCM tokens and browser Web Push subscriptions; do not send one provider's token through another provider.

Use Firebase for Android call wake-up and direct APNs PushKit for iOS; do not initialize an unrelated iOS Firebase application merely to enable Android FCM. Keep permission requests citizen-initiated and the server authoritative for calls; native call UI does not authorize joining media. iOS PushKit calls must be reported to CallKit before the JS bridge is available, with native completion ownership.

**Why:** The existing browser/direct-FCM infrastructure does not deliver to Expo tokens. Extending the mobile app must preserve existing notification channels rather than repurpose their credentials or storage.

**How to apply:** Bind opt-in to the authenticated account/session. Distinguish registration, provider acceptance, real device delivery and native incoming-call UI. Passing exports or showing a settings switch proves none of the latter. Ordinary notification taps must never auto-answer. Native locked-screen calling needs separate CallKit/Android Telecom work and real-device verification.

Keep release blocked until provisioned physical Android/iPhone testing proves correct-account ringing, explicit answer, cancellation, logout and audio continuity. Report force-stop limitations separately; tests and native config inspection do not prove a compiled binary or locked-phone delivery.

Android custom ringtone changes require a new channel identity and a native
rebuild; do not rely on recreating an existing channel or an OTA update.

**Why:** Android retains channel sound settings after creation, and the sound
asset must exist in the installed application's native resources.

**How to apply:** Verify both upgraded and fresh installations, while respecting
user-muted channels, silent mode and Do Not Disturb.

Do not assume the installed Notifee version exposes Android full-screen intent
access APIs; verify its actual exports before integrating permission checks.

**Why:** Notifee 9.1.8 exposes notification and alarm settings but not the
full-screen intent status needed for Android 14+ enrollment checks.

**How to apply:** Keep native capability checks explicit and fail closed when the
installed binary lacks the needed bridge; never equate notification permission
with full-screen access.
