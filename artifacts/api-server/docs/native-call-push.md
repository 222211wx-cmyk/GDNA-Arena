# Native locked-screen call transport

Native push is an optional wake-up transport for the existing PostgreSQL-owned
invitation. It does not create a second call or accept endpoint. Agora WebSocket
answer/resume and `POST /api/call/decline?id=...` remain authoritative.

## Registration and authorization

- `POST /api/call-push/native-installations`: `{ installationId, provider, token }`;
  provider is `fcm` or `apns-voip`.
- `DELETE /api/call-push/native-installations`: `{ installationId }`.
- Both require the existing authenticated HTTP session. Identity comes only from
  that session, and registration checks the canonical unexpired session row.
- Each installation has one owner/session; multiple installations per user are
  allowed. Re-registration transfers ownership. Removal is session-bound, so an
  old session cannot delete a newer account's registration.
- Delivery checks the canonical session store, removes stale registrations, and
  rechecks ownership before dispatch. Logout/session expiry/account transition
  therefore cannot authorize subsequent sends via a stale registration.
- `GET /api/call-push/calls/:id` aliases the existing Expo active-check handler;
  it returns `{ active }` with the same callee/ringing/expiry checks. The original
  `/api/expo-push/calls/:id` remains supported.

## Providers and credentials

**Current mode: iOS VoIP disabled.** `APNS_VOIP_ENABLED` defaults to off and
must be exactly `true` to accept APNs VoIP installations or attempt delivery.
Disabled registration returns an explicit unavailable error (not `ok: true`);
existing APNs tokens are skipped before any delivery claim. Android FCM and
browser/Expo push remain independent and need no Apple credentials. The mobile
app separately has `expo.extra.iosVoipEnabled: false` in static `app.json`;
its iOS native mods and registration are disabled. To restore VoIP later,
Apple Developer provisioning and a signed iPhone build are prerequisites:
set that static mobile flag to `true`, set `APNS_VOIP_ENABLED=true` on the
server, configure the five APNs values below, rebuild, and verify real-device
delivery. Neither flag alone demonstrates APNs provider acceptance or ringing.

Android uses Firebase Admin and the existing `FIREBASE_SERVICE_ACCOUNT`, respecting
`FCM_ENABLED=false`. Native FCM does not require browser VAPID or public web Firebase
configuration. No new API key is needed.

iOS APNs is in **mock mode by default**, as requested while no Apple Developer
account is available. Mock mode skips Apple credential checks and network sends,
and never records a successful provider delivery. It does not simulate real
locked-screen ringing. Do not request Apple credentials for Android builds.

Only an explicit future opt-in with `APNS_VOIP_MODE=live` enables the real
transport, which requires these server secrets/configuration:

- `APNS_VOIP_KEY_P8`: APNs signing key PEM (literal or escaped newlines).
- `APNS_VOIP_KEY_ID`: Apple key identifier.
- `APNS_VOIP_TEAM_ID`: Apple team identifier.
- `APNS_VOIP_BUNDLE_ID`: actual provisioned app bundle identifier; the existing
  mobile app is `com.gdna.arena.mobile`. Do not invent or switch bundle identities.
- `APNS_VOIP_ENVIRONMENT`: exactly `sandbox` or `production`, matching the token
  and provisioning environment.

The server sends ES256 JWT-authenticated HTTP/2 pushes with topic
`${APNS_VOIP_BUNDLE_ID}.voip`, push type `voip`, priority 10 and bounded expiration.
Provider absence/failure produces explicit token-free diagnostics and does not
fail call creation or the browser/Expo transports. No credentials were inspected,
provisioned or tested against live providers during implementation.

## Payload and ordering

After authoritative commit, native incoming payload is
`{ type: "call", callId, callUUID, recipientId, callerName, handle, expiresAt, hasVideo }`.
Recipient/handle are server-derived string user IDs, caller name is sanitized and
bounded, expiration is ISO and `hasVideo` is boolean (stringified in FCM data).
`callUUID` uses SHA256(callId)'s first 32 hex digits, with version nibble 5 and
RFC 4122 variant bits set. Clients must use this identical derivation.

FCM is **data-only**, Android high priority, with TTL bounded by invitation expiry.
The invitation is rechecked before ringing delivery. Terminal events use data-only
FCM `type: "call-ended"` with the same call ID/UUID, recipient and terminal status.
**No APNs VoIP cancellation/answered/ended pushes are sent.** iOS must dismiss using
authoritative state, WebSocket events and local expiration.

Durable `(installation_id, event_key)` claims prevent concurrent/repeated sends.
Definite failures release the claim to allow later retries; a process death after
claim can lose that wake-up (there is no new durable background retry worker).
Provider acceptance is not proof of device presentation. Devices must reject stale
payloads and verify current call state before answering. If native FCM and Expo
share the same installation ID/session, Expo incoming-call delivery is suppressed
for that installation; other Expo notifications/devices remain unchanged.

## Schema and verification

Migration `0024_native_call_push.sql` adds only the native installation and
delivery tables and indexes. Drizzle schema exports and journal are included.
Apply through normal Replit Publish schema ownership, **not production startup
DDL or history replay**. No database migration was executed here.

Focused unit tests cover expiration, UUID format/determinism, sanitization,
provider payload headers/data-only priority, token validation, canonical session
authorization, ownership transfer/removal, dedupe and absence of terminal VoIP.
Physical locked-screen device testing with provisioned credentials remains required.
