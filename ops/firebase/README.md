# Web call invitations: Firebase setup

This integration is **web-only**. It uses Firestore for durable call invitations
and missed-call records, Firebase Authentication custom tokens for read-only
listeners, and FCM Web Push for background invitations. No mobile client is part
of this setup.

## Server configuration

Set these server secrets/configuration values through the deployment secret
manager (never commit their contents):

- `FIREBASE_SERVICE_ACCOUNT_JSON`: Firebase service-account JSON.
- `FIREBASE_WEB_CONFIG`: public Firebase web config as JSON, containing
  `apiKey`, `authDomain`, `projectId`, `messagingSenderId`, and `appId`.
- `FIREBASE_VAPID_PUBLIC_KEY`: Web Push VAPID public key.

All three are required. `GET /api/call-push/config` reports `enabled: false`
with an explicit readiness reason when any value or Firebase Admin is
unavailable. Other call-push API endpoints return `503`. When Firebase is
configured, a failed Firebase operation returns explicit
`FIREBASE_OPERATION_FAILED` and does not create a partial invitation. When it
is not configured, the explicit disabled state lets a socket-connected
deferred call continue ringing in-app for 30 seconds using the existing
PostgreSQL missed-call notification/history path; no fake Firestore inbox item
is created. Existing non-deferred signaling remains independent.

## Firestore data and access model

The server is the sole writer:

- `calls/{callId}` has caller/callee IDs, `ringing|accepted|declined|missed|
  cancelled|ended` status, `video|voice` type, server timestamps, caller
  display metadata, and `deferredMedia: true`.
- `users/{uid}/devices/{installationId}` stores the FCM token, server-side
  session hash, and `focused` heartbeat. A focus heartbeat older than 30
  seconds is treated as unfocused to avoid suppressing a push after a tab
  disappears.
- `users/{uid}/sessions/{sessionHash}` is server-written when a Firebase custom
  token is issued. Rules require a live matching record for each Firestore
  read, and logout marks it revoked so cached Firebase ID tokens lose access
  immediately.
- `users/{uid}/missedCalls/{callId}` is an idempotent, server-written missed or
  declined entry. Clients read their own records and mark them seen through
  `POST /api/call-push/missed/seen`.

Deploy the rules and required composite indexes from this directory with the
Firebase CLI:

```sh
cd ops/firebase
firebase deploy --only firestore --project YOUR_FIREBASE_PROJECT_ID
```

`firebase.json` deploys both `firestore.rules` and
`firestore.indexes.json`. The indexes cover the server expiration sweep
(`status`, `expiresAt`) and the callee ringing-listener query
(`calleeId`, `status`); deploy them before enabling Firebase invitations so
neither operation silently fails on a missing index. The rules allow only
participant reads of calls and own-user reads of missed calls. They deny all
client writes, token reads, and arbitrary user/call access.

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
   bind one authenticated socket, then `call-answer` with `answer: null`.
   Firestore transaction arbitration makes the first answer win across devices.
3. Server reports acceptance. The caller sends `call-webrtc-offer`; the bound
   callee replies `call-webrtc-answer`. These and ICE relay solely across the
   accepted call's exact bound sockets.

Caller `call-cancel` (or legacy pre-answer end/reject) cancels a ringing
invitation. Declined and missed calls create missed-call entries and send an
Arabic data-only `MISSED_CALL` push (with `title`, `body`, and `callerName`)
with a longer TTL; terminal events carry `CALL_ENDED` or `MISSED_CALL`.
The server runs a bounded, paginated expiration sweep at startup and every
minute, so a process restart cannot leave Firestore invitations ringing
forever.

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