# Web call invitations: Firebase setup

This integration is **web-only**. It uses Firestore for durable call invitations
and missed-call records, Firebase Authentication custom tokens for read-only
listeners plus the owner-only seen acknowledgement, and FCM Web Push for
background invitations. No mobile client is part of this setup.

## Server configuration

Set these server secrets/configuration values through the deployment secret
manager (never commit their contents):

- `FIREBASE_SERVICE_ACCOUNT_JSON`: Firebase service-account JSON.
- `FIREBASE_WEB_CONFIG`: public Firebase web config as JSON, containing
  `apiKey`, `authDomain`, `projectId`, `messagingSenderId`, and `appId`.
- `FIREBASE_VAPID_PUBLIC_KEY`: Web Push VAPID public key (optional; without it,
  Firestore invitation persistence and custom-token sessions remain available,
  but browser push delivery is disabled).
- `VITE_FIREBASE_VAPID_KEY`: the same public VAPID key for the browser's
  token request. The Vite Firebase web configuration must target the same
  project as the service account.

The service account and exact public web config are required for the durable
Firestore integration. `GET /api/call-push/config` reports `enabled: false`
with an explicit readiness reason when either is unavailable. With those two
values present but no VAPID key it reports `enabled: true`,
`pushEnabled: false`, and a `pushReason`; call lifecycle persistence is still
active while browser push is disabled. Other call-push API endpoints return
`503` when durable Firebase services are unavailable. When Firebase is
configured, a failed Firebase operation returns explicit
`FIREBASE_OPERATION_FAILED` and does not create a partial invitation. When it
is not configured, the explicit disabled state lets a socket-connected
deferred call continue ringing in-app for 30 seconds using the existing
PostgreSQL missed-call notification/history path; no fake Firestore inbox item
is created. Existing non-deferred signaling remains independent.

## Firestore data and access model

The server owns all lifecycle writes; the authenticated inbox owner may
acknowledge `seen` directly under the narrow rule described below:

- `callInvites/{callId}` has canonical `fromId`, `fromName`, `toId`,
  `type` (`video|voice`), and `status`
  (`ringing|answered|declined|missed`) fields, server timestamps,
  optional caller display metadata, and `deferredMedia: true`. The WebSocket
  transport may continue to call its in-memory terminal state `accepted`;
  the durable Firestore value is always `answered`; when an answered call
  finishes, `endedAt` is added without changing that status.
- `users/{uid}/devices/{installationId}` stores the FCM token, server-side
  session hash, and `focused` heartbeat. A focus heartbeat older than 30
  seconds is treated as unfocused to avoid suppressing a push after a tab
  disappears.
- `users/{uid}/sessions/{sessionHash}` is server-written when a Firebase custom
  token is issued. Rules require a live matching record for each Firestore
  read, and logout marks it revoked so cached Firebase ID tokens lose access
  immediately.
- `users/{uid}/missedCalls/{callId}` is an idempotent, server-written missed or
  declined entry with canonical `{fromId, fromName, type, time, seen:false}`
  fields. Legacy `caller`/`isSeen` aliases may be present while clients
  migrate. Clients read their own records and mark them seen through
  `POST /api/call-push/missed/seen`; Firestore rules also permit an authenticated
  owner to update only the canonical `seen` acknowledgement.

Deploy the rules and required composite indexes from this directory with the
Firebase CLI:

```sh
cd ops/firebase
firebase deploy --only firestore --project YOUR_FIREBASE_PROJECT_ID
```

`firebase.json` deploys both `firestore.rules` and
`firestore.indexes.json`. The indexes cover the server expiration sweep
(`status`, `expiresAt`) and the recipient ringing-listener query
(`toId`, `status`); deploy them before enabling Firebase invitations so
neither operation silently fails on a missing index. The rules allow only
participant reads of call invitations and own-user reads of missed calls. They
deny lifecycle writes, token reads, and arbitrary user/call access; the sole
client write exception is the owner's `seen: true` acknowledgement above.

Firebase custom tokens use `uid = String(PostgreSQL user id)` plus numeric
`userId` and hashed `sessionTag` claims for the call rules. Clients should use
Firebase **in-memory** auth persistence, explicitly Firebase-sign-out and call
device deletion at application logout. The API removes the current session's
device records, marks the session revoked, and revokes Firebase refresh tokens
at logout. Firebase cleanup is awaited: if Firebase is unavailable after the
HTTP session has been ended, the logout/password/account response reports
`firebaseRevocationPending: true` rather than claiming immediate cloud
revocation. Do not log custom tokens, FCM
tokens, service accounts, or authorization headers.

## Deferred WebRTC protocol

Only when `CALL_MEDIA_PROVIDER=webrtc` is ready with the existing TURN
configuration. Deferred frames retain the established
`{ provider: "webrtc", version: 1 }` transport object:

1. Caller sends `call-offer` with `deferredMedia: true` and `offer: null`.
   The server rechecks caller reserve/credit authorization and both block
   directions, persists a 30-second invitation, and sends a high-priority,
   30-second-TTL `INCOMING_CALL` push only to stale/unfocused installations.
2. Callee sends `call-resume { callId }` after a Firestore/push discovery to
   retrieve the authenticated invitation, then `call-answer` with `answer: null`.
   Firestore transaction arbitration makes the first answer win across devices.
3. Server reports acceptance. The caller sends `call-webrtc-offer`; the bound
   callee replies `call-webrtc-answer`. These and ICE relay solely across the
   accepted call's exact bound sockets.

Caller `call-cancel` (or legacy pre-answer end) marks a ringing invitation
`missed` and creates its missed inbox entry. Callee rejection is `declined`.
Declined and missed calls create missed-call entries and send an
Arabic data-only `MISSED_CALL` push (with `title`, `body`, and `callerName`)
with a longer TTL. Answer/end synchronization uses Firestore and WebSockets,
not push, because the requested basic worker displays every received push.
The server runs a bounded, paginated expiration sweep at startup and every
minute, so a process restart cannot leave Firestore invitations ringing
forever.

## Requested basic background worker

The web worker uses the exact Firebase compat 10.7.0 source supplied by the
owner. It displays `payload.notification` or the supplied Arabic defaults.
Our server sends data-only messages to avoid Firebase auto-display plus the
worker's manual display producing duplicate notifications. Consequently the
basic worker uses its default text for these pushes, including incoming calls.
Caller-specific content and explicit acceptance remain in the foreground app.
This exact worker has no notification-click actions, expiration filtering,
or notification cleanup. Do not claim it provides those features.
FCM sending stays on the authenticated API server with Firebase Admin; never
place a service-account credential in browser code.

## HTTP contract

`GET /api/call-push/config` returns readiness and public runtime Firebase
configuration. Authenticated endpoints are:

- `POST /api/call-push/session`
- `POST` / `DELETE /api/call-push/devices`
- `POST /api/call-push/focus`
- `GET /api/call-push/missed`
- `POST /api/call-push/missed/seen`

The precise request and response schemas are maintained first in
`lib/api-spec/openapi.yaml`; generated clients/types come from that spec.