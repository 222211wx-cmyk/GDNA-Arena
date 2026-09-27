# Native call release gate


## Final preview with ten-message trial

Clear-cache build `f21486e1-594b-437d-8b6b-bba57b2639ae` completed successfully.
Direct APK: https://expo.dev/artifacts/eas/CtqJ9MMxXAyDeLZiXEdakTdlXn38D4v2LC95XAes2v4.apk

Downloaded APK verified with `apksigner`: v2 signature, one signer.
SHA-256: `dbe65f6ed8cd59072a29dfd332074a1400e8413cd313a814e2ed76993090a417`.
Includes existing Telecom fixes and ten lifetime free messages. Exhausted text:
“Contactez l'AMIS pour activer”. Reading history remains free.
The development integration test accepted exactly ten of eleven concurrent sends
across sessions/rooms, preserved history access and prevented deletion resetting
the allowance. New quota API/schema changes require normal Publish, separately
from the owner's earlier publication. Physical Android and live FCM proof remain
outstanding; native compilation/signature do not certify them.

## Current status — signed native build verified, physical proof pending

Latest preview build completed on 2026-09-27 with `--clear-cache`:
https://expo.dev/accounts/qaisypro2024/projects/gdnaarena/builds/17a71ac4-1f43-45a2-8edc-70d176ef1c82

Direct APK:
https://expo.dev/artifacts/eas/ol34RcfHspy4YKYIzPBiN29a18qN5EIdry_92ScyIaY.apk

Downloaded file passed `apksigner verify --verbose`: v2 signature, one signer.
SHA-256: `ea4a754d83ce57ecca3502431c866471b00740d497e3181e388179cf253a4ca5`.
No physical Android startup/ringing/audio validation has been performed.

Android now has a dedicated Kotlin self-managed PhoneAccount/ConnectionService,
incoming/outgoing call lifecycle, lockscreen Activity with showWhenLocked /
turnScreenOn and explicit answer/decline, and a phoneCall|microphone foreground
service. Authenticated invitation checks precede FCM presentation. Agora capture
starts only after explicit call consent, server/device authorization, runtime
microphone permission, a resumed React activity and successful foreground-service
startup. Telecom/full-screen failures do not silently become notification-only
success. No specialUse workaround is used.

Source cleanup covers decline, cancel, expiry, remote end, account changes and
setup failures. Audio-focus interruption ends the call rather than automatically
resuming it; Telecom mute/route changes are relayed to Agora.

- TypeScript passes; **29 targeted native-call/Agora/plugin tests pass**. These
  include idempotent native-source generation, not native compilation or device proof.
- Clear-cache Android build **failed Kotlin compilation**:
  https://expo.dev/accounts/qaisypro2024/projects/gdnaarena/builds/2ee2221f-9c1b-4d81-9f64-035d0efae59a
  Reported failure: `CallTelecomModule.kt:208`, unresolved `currentActivity`.
  Source corrected to `reactApplicationContext.currentActivity` for RN 0.81,
  with a generated-source regression assertion. The replacement build above
  compiled and its downloaded signature verifies; physical behavior remains unverified.
- Secure keyguard may require unlocking after Answer before the authenticated
  app resumes and microphone capture can start. The incoming native screen is
  lockscreen-capable; unlock-free accepted audio is not certified.
- Headset/Bluetooth routing, cellular interruption, background capture, OEM FCM
  behavior and force-stop restrictions remain physical release gates. No new
  explicit speaker/Bluetooth picker UI is included.
- Manual administrator entitlement is implemented in web/mobile/API. The
  development migration is applied; production requires normal **Publish**.
  This is not automatic billing/subscription provisioning.
- iOS APNs remains mock-only; no Apple provisioning or physical iOS validation.

## Before testing

- Apply the additive native push schema through normal Publish, never startup SQL.
- Publish the manual entitlement schema/API changes to production through the
  normal flow; a completed development migration is not production evidence.
- Obtain the current build result and signed APK before testing; do not substitute
  a historical APK or a passing TypeScript/unit-test run for native compilation.
- Verify server injection and delivery using the existing FCM credential; do not
  request the secret again. The Firebase client JSON is not a server credential.
  APNs remains mock-only, with Apple provisioning and physical iOS tests deferred.
- Build signed native applications. Confirm the Android package matches Firebase
  and the iOS bundle matches the Apple provisioning profile and APNs topic.
- Resolve or explicitly evaluate Expo Doctor's library metadata warnings:
  CallKeep/PushKit are untested on New Architecture; Notifee is marked unmaintained.
  Successful JS exports do not establish native build compatibility.
- Enable phone alerts voluntarily for the recipient account. Check notification,
  microphone, Android phone-account and full-screen access settings.

## Required physical evidence (Android and iPhone separately)

Record app build, OS/device, account roles, observed result and timestamps for:

1. Incoming call while foreground, background, and screen locked.
2. Accept opens the exact call, server authorizes the correct recipient and
   two-way audio works; no audio transmission before explicit acceptance.
3. Decline stops the caller's ringing state; caller cancellation stops the
   recipient UI. Expired and duplicated pushes must not allow stale answers.
4. Lock screen during an accepted call; verify continued two-way audio, mute,
   speaker/Bluetooth routing, interruption by a cellular call, and remote hang-up.
5. Change recipient account while registration is pending. The old account's
   calls must not reach or be answered by the new account.
6. Disable alerts and log out, including a network interruption during logout.
   Verify revoked server sessions cannot receive new pushes or answer calls.
7. Restart the process and test cached native events. Repeat after Android
   force-stop and iOS explicit termination; record OS restrictions, not promises
   that every terminated state can ring.
8. Deny full-screen/notification permissions; verify failures are visible and
   never represented as working native ringing.
9. Confirm the bundled two-pulse custom ringtone on a fresh install and on an
   upgrade with the old `calls` channel already present. Native FCM calls use a
   separate versioned channel because Android channel sound cannot be overwritten.
   Verify user-muted channels, silent mode and Do Not Disturb are respected.
   Rebuild the APK after any bundled-sound change; an OTA update is insufficient.
10. Exercise outgoing calls, native allocation/foreground-service failures and
    microphone denial. Confirm errors are explicit, no stale native call remains,
    and no capture starts before consent and server/device authorization.
11. Record whether secure keyguard requires unlocking after Answer. Confirm
    permission prompts and foreground microphone eligibility; do not report
    unlock-free answering without observing it on the tested device.
12. Test manual administrator entitlement grant, denial and revocation across
    web/mobile/API against the intended environment after its migration/Publish.

Distinguish provider acceptance, simple notification, native ringing, correct
call opening, and sustained audio as separate outcomes. A screenshot or a passing
unit test proves none of the physical-device cases.

## Historical build evidence — does not certify the current implementation

An earlier Android preview APK compiled successfully on 2026-09-27. Downloaded APK
passed `apksigner verify --verbose` (APK Signature Scheme v2, one signer).
No live provider delivery verified and no physical device cases passed yet.
iOS APNs is mock-only pending a future explicit decision to provision Apple.

- EAS build: https://expo.dev/accounts/qaisypro2024/projects/gdnaarena/builds/867bd3ab-4ce2-4761-9312-997aca0b2dbf
- APK: https://expo.dev/artifacts/eas/cuppyLn6_VgiPNNVaxr1_k51Ncd3UphHmz9ei9BvFGc.apk
- SHA-256: `5826072b84c94d1517c420a018c9ed32e0759f8e95f58a68a4fc813ac15c4ff6`
- Native/plugin unit tests: 21 passed. These are not device evidence.
- Subsequent source-only signaling fixes pass 24 tests: cancelled connection
  attempts cannot resume after effect cleanup, server errors terminate pending
  calls, and socket failures are surfaced. These fixes are not in the APK above
  or the already-uploaded `eb6ec0fe-e6fb-4fa1-9ba1-85b6ee9686cd` build.
  They require a new signed build before device verification.
  Submitted with release API origin and signaling fixes:
  https://expo.dev/accounts/qaisypro2024/projects/gdnaarena/builds/1a13db04-7954-492a-bb38-683fc6aff5c6
  (submission only; build result/signature and device behavior not verified).
- That historical APK is not evidence for the newly implemented Telecom and
  foreground-audio sources. Their native compilation and physical release gates
  remain open, including Android 14 “already in another call” behavior.
