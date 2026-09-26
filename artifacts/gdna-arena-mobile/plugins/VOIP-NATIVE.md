# Native call delivery contract

This plugin targets the installed Expo SDK 54 Swift template, RNCallKeep 4.x and
RNVoipPushNotification 3.x. It patches AppDelegate and its existing Xcode bridging
header idempotently. C inline wrappers use the installed Objective-C public APIs
without depending on Swift's inferred selector spellings. Unsupported templates
fail explicitly.

CallKeep is configured before React starts (GDNA Arena, video supported).
There is **no native PushKit registration at startup**. After voluntary opt-in,
JS calls `registerVoipToken`; the installed notification manager creates its
registry on the main queue and assigns `UIApplication.delegate`. AppDelegate
conforms to PKPushRegistryDelegate and forwards token updates to that manager.
The installed manager has no public token-invalidation event API.

For each incoming call, native reports the server's `callUUID` to CallKit before
forwarding the unchanged PushKit payload. Native alone owns the PushKit
completion; it executes in CallKeep's report completion callback, including
report errors. JS must not register/call a completion handler for these pushes
or report the same incoming iOS call again.

JS must subscribe to both live and buffered events:

- VoIP `notification` and `didLoadWithEvents`
  (`RNVoipPushRemoteNotificationReceivedEvent`, plus buffered registration).
- CallKeep `didDisplayIncomingCall`, answer/end/audio-session actions, and
  `didLoadWithEvents` (native `RNCallKeep...` event names).

Use the unchanged payload's authoritative `callId` to map the server's
`callUUID`, not a fabricated UUID or telephone number. CallKeep action UUIDs
may be lowercased. Buffer early answer/end actions until the mapping/auth is
available. Validate expiry/type/callId on CallKeep display events too: the
library emits these even for invalid/expired calls and report errors.

Expired payloads, wrong types, or other invalid fields **with a valid UUID**
are still reported, then ended natively with CallKit's failed reason as soon as
the report completes. They are not forwarded as actionable VoIP JS events.
This can briefly surface system UI, but does not leave a ringing phantom call.
The server must send only genuine incoming-call invitations; APNs VoIP is
never an arbitrary background cancellation transport.

**Contract limitation:** a missing/malformed `callUUID` cannot be reported to
CallKit using RNCallKeep (its implementation converts it to a nil NSUUID).
Inventing an identity would violate this application's identity contract.
Such a push logs an explicit native error and completes without reporting,
which does not satisfy Apple's reporting rule and may lead to process
termination/throttling. Server-side UUID validation before APNs delivery is
mandatory; this impossible-input case cannot be made compliant by this plugin.

No entitlements are rewritten or invented. Existing expo-notifications owns
standard APNs signing configuration; provisioning must enable Push Notifications.

Android declares CallKeep's real ConnectionService and headless service, plus
Notifee's existing foreground service with `phoneCall` type (overriding the
library's `shortService`). Fullscreen is a notification fullScreenAction, not
a separate invented service. Android 14+ phoneCall eligibility requires
MANAGE_OWN_CALLS/self-managed Telecom setup; microphone service use also needs
granted audio permission and platform while-in-use eligibility. Do not start
microphone capture from a background invite; start only on accepted calls.
JS still must configure channels, Notifee foreground handling and Android's
fullscreen access checks/settings flow. Manifest declarations do not grant
runtime permissions or bypass background restrictions.

Tests read the installed Expo template and Xcode project in a temporary
directory. They verify transformation/API contracts, not native compilation,
physical-device locked-screen delivery, provisioning, or App Store readiness.

## Android-only Firebase

Add `./plugins/withAndroidFirebase` to app.json's plugin list, **not**
`@react-native-firebase/app`. Keep `android.googleServicesFile` pointing at the
real Android configuration. The stock app plugin unconditionally inserts
`FirebaseApp.configure()` and requires `ios.googleServicesFile`; it is not
appropriate for this PushKit-only iOS application.

The local adapter invokes the installed official Android Gradle/copy mods
and messaging plugin (23.8.6 registers only Android manifest mods).
It neither configures Firebase iOS nor changes framework linkage.

**Also disable iOS autolinking for both `@react-native-firebase/app` and
`@react-native-firebase/messaging` in the root react-native.config.js
(`dependencies[package].platforms.ios = null`).** Config plugins do not control
native dependency autolinking. Without that separate exclusion, RNFirebase
pods would still be linked despite there being no iOS Firebase configuration.
There is no reason to enable useFrameworks for Android-only Firebase.
JS Firebase imports/initialization must likewise remain Android-only.