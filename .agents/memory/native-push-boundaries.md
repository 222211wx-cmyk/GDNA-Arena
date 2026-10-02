---
name: Native push delivery boundaries
description: Provider identity and acceptance criteria for native mobile notification work.
---

Keep Expo push tokens distinct from direct FCM tokens and browser Web Push subscriptions; do not send one provider's token through another provider.

Android call enrollment must remain independent of optional Expo generic alerts,
while provider registrations identify the same physical installation for deduplication.

**Why:** coupling these registrations let an Expo setup failure undo working call
enrollment, and unrelated installation identities bypassed duplicate-alert suppression.

**How to apply:** preserve native success when optional alerts fail, report each
failure honestly, and retain historical provider identities until owned cleanup is
confirmed. Never delete or suppress every device merely because it shares a user.

User decision: iOS VoIP is deferred until Apple Developer provisioning is available. The iOS VoIP stub must explicitly report unavailable, never fake PushKit registration or delivery success. Keep the real implementation available for later explicit re-enable; Android build/FCM and web push must remain independent of APNs secrets.

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

The owner explicitly requires no further Firebase or APNs secret prompts and
APNs mock-only operation while Apple Developer provisioning is unavailable.

**Why:** Repeated credential prompts blocked Android work despite the owner's
report that Firebase credentials were already stored. Absence from an agent
process is not evidence of absence from every deployment or Secrets scope.

**How to apply:** Use existing runtime credentials without exposing values;
report injection and provider results separately. Never gate an Android EAS
build on server push credentials or Apple provisioning. Keep mocked APNs
outcomes distinct from real delivery, and do not re-enable live Apple transport
without an explicit request.

Secret presence, successful parsing, Firebase initialization, and device
delivery are separate readiness stages.

**Why:** A stored credential can exist in both scopes while the application's
readiness endpoint rejects its format. Repeatedly asking for the same secret
or republishing cannot establish which stage failed.

**How to apply:** Honor the no-new-prompts rule, support the owner's existing
credential name, and expose only sanitized stage-specific diagnostics. Never
inspect or print credential contents, or claim that metadata presence proves
valid server credentials.
