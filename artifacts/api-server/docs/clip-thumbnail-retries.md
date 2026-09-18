# Missing clip posters

The API starts the retry worker 30 seconds after startup, after clip-table
initialization. It then waits five minutes between completed batches.
Public feed, thumbnail, and video requests never trigger generation.

## Limits and retry policy

- At most three clips per batch, processed serially; a PostgreSQL advisory lock
  prevents overlapping batches across API replicas. Locked rows are skipped.
- A batch stops starting work after 90 seconds. Database statements have a
  five-second server timeout.
- The existing generator enforces its 20-second deadline, 64 MiB input budget,
  256 KiB JPEG output limit, 480-pixel bounds, and shared concurrency limit.
- JPEG upload has a ten-second abort deadline. Originals are only read.
- Only unfrozen clips with a null thumbnail are eligible. Existing posters are
  never regenerated. Older clips and failed upload-time poster attempts enter
  the same queue automatically.
- Attempts and the next eligible time are saved before processing. Failures,
  busy-generator rejections, and interrupted attempts all consume the bounded
  eight-attempt allowance. Delays increase from five minutes to 640 minutes.
  Restarts do not reset the allowance or delay. Failed rows cannot indefinitely
  monopolize the first batch.

Completion and failures are logged with clip ID and attempt number; the final
failure includes `exhausted: true`. Persistent state is on `clips`:
`thumbnail_retry_attempts` and `thumbnail_retry_at`. These columns and the partial
due-work index are initialized idempotently alongside the existing raw-SQL clip
table; no production Drizzle migration history is replayed.

## Deletion and interrupted writes

Generation, storage, and thumbnail-pointer publication hold the same clip row
lock used by deletion. If deletion wins, the worker skips the row. If generation
wins, deletion reads and deletes the resulting poster.

Retry object names are deterministic from the clip ID and original object name.
A successful storage write followed by a database failure or process restart
therefore remains associated with its clip even before the pointer commits.
The next attempt overwrites the same candidate, and deletion always removes the
candidate as well as any stored thumbnail pointer. Database deletion commits
before object cleanup. A failed storage deletion is logged, but is not currently
retried durably; the row is already gone. Do not introduce random retry names or
delete candidate objects on ambiguous database commits.

Neither the job nor its retry state writes original media, fingerprints, rights,
duration, views, or earnings. The existing visibility-scoped thumbnail endpoint
serves completed JPEGs; private object names are not returned to the feed.

## Inspect or requeue exhausted clips

After correcting a storage/processing problem, an operator can inspect:

```sql
SELECT id, thumbnail_retry_attempts, thumbnail_retry_at
FROM clips
WHERE thumbnail_object_name IS NULL
ORDER BY thumbnail_retry_at, id;
```

Explicitly requeue a **specific** clip (use a bound parameter, never user SQL):

```sql
UPDATE clips
SET thumbnail_retry_attempts = 0, thumbnail_retry_at = NOW()
WHERE id = $1 AND thumbnail_object_name IS NULL AND is_frozen = FALSE;
```

Do not reset every exhausted clip periodically: permanently unsupported media
must not create an unlimited processing loop. No public/admin HTTP trigger is
added by this worker.

## Isolated PostgreSQL regression tests

From the workspace root:

```sh
pnpm --filter @workspace/api-server run test:integration:thumbnail-retry
```

Requires PostgreSQL's `initdb` and `pg_ctl` on `PATH` and an unprivileged OS
user (as in this workspace). No running API, cloud bucket, ffmpeg, or database
credentials are needed. Missing PostgreSQL binaries fail the suite, not skip it.

The suite starts a disposable local PostgreSQL cluster on a private Unix socket,
with TCP disabled. It never reads `DATABASE_URL` or connects to project databases.
Each test creates a random schema and uses a search path without `public`, then
drops it and closes every pool. Teardown verifies schema removal and stops and
removes the cluster. A separate cluster also isolates advisory locks, which cannot
be isolated by schema alone.

Two separately bundled workers have independent module state and real `pg`
connections. Only media generation, object storage, and logging are substituted;
the worker SQL, route SQL, locking, transactions, and clip-table DDL are real.
Coverage includes replica exclusion and handoff, skipping locked eligible rows,
persisted exponential backoff after destroying/reconnecting PostgreSQL sessions,
the eight-attempt cap, and deletion waiting on a publication row lock. The
deletion test observes `pg_blocking_pids`, then checks original/poster removal,
view cleanup, and preservation of the complete fingerprint row. Authorization
and cleanup of an interrupted poster without a published pointer are also checked.