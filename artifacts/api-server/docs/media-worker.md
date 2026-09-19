# Clip media worker

New clips upload original bytes directly to the existing R2 bucket (configured as
helixly-clips). API receives metadata and ETags, never new clip binary. Historical
R2/GCS playback and chat attachment limits are unchanged.

## Processes and deployment

Build both entrypoints with `pnpm --filter @workspace/api-server run build`.
Run the worker with `PORT=8082 pnpm --filter @workspace/api-server run worker:start`;
`worker:dev` builds first. Health endpoints are `/healthz` and
`/internal-media-worker/healthz`; they disclose only process availability.
The API runs separately on its existing port. Replit project services share a
container and its CPU/memory: process isolation is not independent compute scaling.

A dedicated host may run `node --enable-source-maps artifacts/api-server/dist/media-worker.mjs`
after installing workspace dependencies and building. It needs Node, ffmpeg and
ffprobe in PATH, writable temporary disk sufficient for an original and encoded
output (plan for files up to 10 GiB), the same DATABASE_URL and existing R2
configuration/secrets as the API, plus historical storage credentials for retry
maintenance. Never copy secret values into commands or documentation. No paid
external processing provider is activated.

Apply only the reviewed additive `scripts/clip-media-jobs.sql` in development.
The separately reviewed `scripts/clip-media-cap.sql` widens the existing named
size CHECK from 2 GiB to 10 GiB without deleting data or schema objects; its
matching Drizzle check must be promoted as well.
The matching Drizzle schema enables Replit Publish to promote the queue table
and partial claim index. Production startup never runs this SQL or migrations.
Deploy schema, API, worker and clients coherently.

## Protocol

`POST /api/upload/presign` retains initiate/part/inspect/abort actions and session
ownership checks. `/api/r2/presign` remains a metadata-only compatibility alias.
5 MiB parts require at most 2048 parts for 10 GiB. ListParts is paginated.

`POST /api/upload/complete` (alias `/api/clips/create`, presign complete action)
completes R2 multipart, HEAD-validates owner/session/size/type and transactionally
enqueues once. It returns 202 with sessionId, state and statusUrl. Clients must
poll owner-only `GET /api/upload/status/:sessionId`; acceptance is not publication.
States: queued, processing, ready (receipt), failed (error). Unverified files never
enter the clips table/feed. Worker verifies real stream type and duration >=60s,
encodes video to <=720p/AAC (`_720p.mp4`) or audio AAC, verifies output, then commits
publication and ready state together. Original pointer is retained.

Legacy binary `/api/clips` POST, `/api/clip/upload`, upload-simple, upload-final,
and `/api/clips/uploads` Tus paths return 410 with migration endpoints.

## Recovery

Queue claims use the partial retry_at/session index and FOR UPDATE SKIP LOCKED.
A two-minute lease is renewed every 20 seconds. A unique per-attempt token fences
publication and unique output reservation prevents stale overwrite. Attempts have
exponential retry backoff; eight failures dead-letter as failed. Stale leases are
reclaimable after restart. Retry candidate cleanup uses the existing durable
cleanup table; originals are retained. SIGTERM interrupts active new processing
and queues retry, then closes health and database connections. Crash recovery
uses the lease deadline. Existing compression/thumbnail/storage/temp maintenance
runs only in the worker, sequentially under a shared advisory lock. One ffmpeg
workload runs at a time across cooperating workers; encoder threads are bounded.
Health is liveness, not a claim that database/R2 are available.

Expired multipart maintenance selects only active sessions and explicitly
excludes sessions having a media job. Storage cleanup also excludes originals
retained by media jobs, including failed jobs. Queued/retrying originals do not
expire after the 48-hour multipart activity window.

Encoding has no total execution deadline or maximum duration: only a 10-minute
stall (no advancing ffmpeg progress) aborts an encode. Storage transfers also
use a 10-minute inactivity timeout. Original/output probing remains bounded to
30 seconds and 64 MiB read per probe; difficult or malformed containers can fail
verification within those resource bounds even when below 10 GiB. Size support
is not a promise that every 10 GiB codec/container is processable or finishes
quickly on shared CPU/disk.

Tests: `node --test tests/r2-display-title.test.mjs tests/media-worker-boundary.test.mjs`
from the API directory; `pnpm run test:clip-media` covers real ffprobe/thumbnail
fixtures. Real browser transfer, R2 throughput and hard process-kill checks must
also be exercised in the deployed environment; mock-boundary unit tests do not
measure those.