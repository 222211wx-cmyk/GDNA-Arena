# Calls and messaging tab — code handover

## Delivery boundary

The owner requested a tab-by-tab handover with outstanding work stated explicitly,
instead of repeatedly retrying the same blocked EAS build. This is a code-level
handover, not certification of native locked-screen ringing or store readiness.
The existing layout and product structure remain unchanged.

## Implemented in the mobile code

- Conversation list/search, direct conversations, and group/community entry.
- Encrypted text, image and video send/receive, loaded history, live authenticated
  WebSocket updates with reconnection and duplicate protection.
- The integrated main-project changes retain media-upload progress, compression
  and explicit retry of failed attachments.
- Audio/video call initiation, explicit accept/reject/end, call history, and the
  shared authenticated Agora controller. No automatic answer.
- Voluntary native notification enrollment, account-bound registration, and
  logout/account-switch cleanup.
- Android FCM background handler loaded before Expo Router; Notifee call
  notification with explicit actions and a bundled custom ringtone.
- Android 14+ full-screen permission checks, an explicit settings action, and
  fail-closed enrollment when support cannot be established.
- Native iOS PushKit/CallKit reporting and buffered actions, kept separate from
  the web implementation.

## Verification and limitations

TypeScript and focused native-call/plugin unit tests pass. These checks do not
establish successful Kotlin/Swift compilation, provider delivery, or device audio.
No physical-device evidence has been recorded. The preview is not a native-call
test; Expo Go cannot supply these custom native modules.

## Open release gates — not completed

1. Produce a signed Android APK from the latest workspace. The previously
   published GitHub snapshot predates the latest full-screen permission fixes.
   EAS last rejected the build because its project had no linked repository.
   Confirm an actual change to that linkage before retrying, then sync the code.
2. Make server FCM credentials available and verify delivery; apply the additive
   native-push migration using normal Publish. A client Firebase JSON alone does
   not provide server authorization.
3. Finish/evaluate Android Telecom and accepted-call foreground audio lifecycle.
   Declared services alone are not a working Telecom integration.
4. Run the physical cases in `native-call-device-checklist.md`: foreground,
   background, locked screen, accept/decline/cancel, sound, audio continuity,
   account switch/logout, and revoked permissions.
5. Provision APNs and a signed iOS build for equivalent iPhone proof.
6. Evaluate the existing Expo Doctor native-library metadata warnings against
   actual native compilation; do not hide warnings or equate exports with builds.

Android Force stop, user-muted channels, silent mode, Do Not Disturb and battery
restrictions must be reported honestly, not promised away.

## Messaging extensions not delivered by this change

General document uploads, message edit/delete/unsend, delivery/read indicators,
paginated history and an explicit failed-text-send retry UI are not claimed as
complete. They are distinct
future feature work, not evidence that the existing text/image flow is absent.