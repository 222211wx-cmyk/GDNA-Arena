# Lite API contract

All URLs start `/api`. Session cookies are used; never send identity from local storage as authority.

- `GET /lite/citizens?before=<id>&limit=12&q=<username>` → `{citizens:[{id,username,displayName,bio,avatarUrl}],nextCursor:number|null}`. Maximum 20 records; bio is 160 characters.
- `GET /lite/profile/:username` → `{profile:{id,username,displayName,bio,avatarUrl}}`; hidden/blocked/deleted profiles return 404.
- `GET /lite/market?before=<id>&limit=12` → `{listings:[{id,type,title,description,price,seller:{id,username,displayName,bio,avatarUrl}}],nextCursor}`.
- `GET /lite/clips?before=<id>&limit=12` → `{clips:[{id,title,durationSec,username,audio:AudioStatus}],nextCursor}`. AudioStatus is defined below. No autoplay, video URLs, thumbnails or speculative audio sizes. Audio is unavailable unless a real derivative exists; do not label original video as audio.
- `GET /lite/avatar/:username?slow=1` → real WebP, at most 5120 bytes (otherwise 10240). Only stored, visible citizen avatars are accepted, never URL parameters. 404 if absent/hidden; 503 if encoder/storage unavailable. All Lite responses are private/no-store.

Reads are public with optional authenticated projection (mutual friends/self visibility, bidirectional blocks). No email, age, birth date, balances, location, phone or private profile settings are exposed.

## Messaging

Offline queue/SW must also supply `expectedSenderId` (integer account ID captured at enqueue). This is an expectation, not an auth identity: a mismatch against the current session returns 409 BEFORE any membership lookup, reservation, or insertion. Never drain a prior account's queue into a newly signed-in session.

Use existing E2EE browser helpers and existing `/messages` APIs, **not a Lite plaintext endpoint**. POST `/messages/rooms/:id/send` with the existing encrypted `content` envelope, `type:"text"`, and optional `clientMessageId:crypto.randomUUID()`. Persist that UUID AND the exact encrypted envelope in the local retry queue; retry with identical bytes. Do not re-encrypt retries. Scope UUID to sender, not room. Reuse with different payload/room returns 409. Unencrypted requests with a UUID are rejected. Success retains `{message,xpEarned}`; a replay returns 200 with `replayed:true,xpEarned:0`, original message ID, without another notification or XP award. Fresh send returns 201. Membership and block checks still apply.

Existing key registration / room key retrieval and encryption helpers must be reused; Lite does not implement cryptography. No delivery claim before server acknowledgement. Treat 409 as requiring user action (do not silently change queued ciphertext).

If the original message was deleted or expired, retry returns 410 rather than resurrecting it. Receipts store a request hash and message ID only, not another copy of ciphertext.

## Audio and mirrored Lite posters

- Authenticated `POST /lite/clips/:id/audio` queues audio and (if an existing poster exists) a bounded Lite WebP poster. Returns 202 `{audio,poster}`. Idempotent; jobs survive restarts. Visibility, videos field visibility and blocks apply.
- Authenticated `GET /lite/clips/:id/audio` returns `{audio,poster}`. Each is `{status:"unavailable"|"queued"|"processing"|"ready"|"failed",sizeBytes:number|null,mime:string|null,durationSec:number|null,url:string|null,requiresConsent:boolean,error:string|null}`. Poll only while queued/processing. Feed clips expose the same `audio` metadata (no binary auto-download).
- Authenticated `GET /lite/clips/:id/audio/play?consent=1` serves only verified audio bytes. The consent flag is REQUIRED when actual encoded bytes exceed 1 MiB; otherwise 413 with size/consent metadata. UI must ask before adding this flag. HTTP byte ranges supported.
- Authenticated `GET /lite/clips/:id/poster` serves the actual ≤10KB WebP derivative.

Worker accepts sources ≤128 MiB and actual duration ≤600 seconds. It extracts audio only, AAC mono 24kbps in M4A, and publishes actual probed duration/encoded byte count (`audio/mp4`). Already-audio AAC/MP3/Ogg sources without video may be reused if ≤3 MiB; these retain actual MIME/size. Larger audio is transcoded. No-audio/overlong sources fail explicitly; never silently truncate or send a video as audio. Actual size is variable, never a fixed 200KB claim.

New R2-backed Lite audio/poster outputs are mirrored into App Storage and read-back SHA-256 verified before publication. Playback falls back only to that stored, verified mirror after the primary read fails, and checks size/hash again before responding. Failure of both providers returns 503. App Storage-native outputs use App Storage directly. Coverage is ONLY newly generated Lite audio/posters: legacy originals, main video playback, old posters and citizen avatars are not automatically replicated. Universal R2 fallback cannot be promised without separately copying those bytes.

## Verification and development schema

`pnpm --filter @workspace/api-server test:lite` checks compact allowlists, PostgreSQL privacy predicates, real WebP byte/dimension bounds, and 24 concurrent sender-scoped UUID attempts with rollback/conflict cases. `lib/db/drizzle/lite-send-receipts.sql` is reviewed additive development SQL (one receipt table); it has been applied to development only. Production schema is applied through Publish; there is no startup DDL or destructive push.

`pnpm --filter @workspace/api-server test:lite-media` checks actual AAC/WebP encoding, actual-audio reuse, no-audio/overlong rejection, temporary-file cleanup, PostgreSQL worker reservations/backoff/crash recovery/deletion outbox, injected R2/App Storage failures, hash-mismatched copy refusal, and HTTP sender-expectation rejection with zero message/receipt inserts. `lib/db/drizzle/lite-media.sql` adds only the derivative manifest/job table and index, applied to development only.

The existing media-worker must be running for queued derivatives to progress. No new worker process or API-side encoder loop is started. Four bounded attempts use persisted exponential backoff. Both provider object names are reserved before upload; clip/account deletion and failed jobs enqueue both immutable derivative copies for the existing cleanup worker. Originals are never overwritten or removed by derivative generation. The legacy orphan reconciler protects the Lite namespace; explicit derivative deletion goes through the durable outbox.