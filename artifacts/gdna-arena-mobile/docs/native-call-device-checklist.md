# Native call release gate

Status: implementation and local configuration checks only. No APK/IPA compiled,
no live provider delivery verified, and no physical device cases passed yet.

## Before testing

- Apply the additive native push schema through normal Publish, never startup SQL.
- Configure server FCM service credentials and APNs VoIP credentials as described
  in the API server's native-call-push documentation. The Firebase client JSON is
  not a server credential.
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

Distinguish provider acceptance, simple notification, native ringing, correct
call opening, and sustained audio as separate outcomes. A screenshot or a passing
unit test proves none of the physical-device cases.