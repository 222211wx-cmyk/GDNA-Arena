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
candidate as well as any stored thumbnail pointer. Before committing deletion,
the same transaction inserts deduplicated object names into
`clip_storage_cleanup`. This table deliberately has no foreign key to clips or
users. Failed enqueue rolls back deletion; an ambiguous commit cannot cause
cleanup of a surviving clip. Do not introduce random retry names or delete
candidate objects on ambiguous database commits.

After commit, deletion tries the queue immediately. The independent cleanup
worker starts 30 seconds after API startup and waits one minute between batches.
It processes at most 12 due objects serially, stops starting work after 90 seconds,
and uses five-second database statement and ten-second storage wait deadlines.
Claims atomically advance attempts/backoff before storage access and skip locked
rows, so replicas, immediate cleanup, and restarts share the same durable state.
Backoff doubles from five minutes to a maximum of 24 hours. Unlike thumbnail
generation, **cleanup never exhausts its retries**.

Each successful or already-missing object is acknowledged independently. Partial
failures retain only unfinished queue entries. A crash after storage success but
before acknowledgement safely repeats deletion with `ignoreNotFound`; an older
attempt cannot acknowledge a newer claim. A timed-out storage request may finish
later, which is safe because clip object names identify immutable uploads and
cleanup only deletes. Storage/DB failures never recreate clips or remove rights.
Inspect backlog age and attempts with:

```sql
SELECT clip_id, object_name, attempts, retry_at, created_at
FROM clip_storage_cleanup ORDER BY retry_at, object_name;
```

After fixing an outage, optionally expedite a **specific deleted clip**:

```sql
UPDATE clip_storage_cleanup SET retry_at = NOW() WHERE clip_id = $1;
```

Already-deleted clips from before this queue existed cannot be recovered from
the absent rows. The separate [clip storage reconciliation](clip-storage-reconciliation.md)
command can produce a conservative, read-only inventory for operator review, but
it is not a bucket-wide garbage collector and cannot enqueue or delete objects.
In particular, resumable-upload paths are intentionally held rather than inferred
to be abandoned.

Neither the job nor its retry state writes original media, fingerprints, rights,
duration, views, or earnings. The existing visibility-scoped thumbnail endpoint
serves completed JPEGs; private object names are not returned to the feed.

## Inspect or requeue exhausted clips

Open `/admin/clips/thumbnails` to inspect clips that have a null poster after
exhausting all eight attempts. The admin API lists them newest-first with a
bounded page size (default 25, maximum 100) and an ID cursor. Inspection is
limited to 60 requests per minute per authenticated admin.

Always fix the cause first: confirm storage access, generator dependencies,
supported source media, and current worker health before requeueing. In the UI,
review the clip ID/title/owner, attempt count, last scheduled retry, and frozen
state, then use the targeted confirmation for that one clip.

Requeue is limited to 10 requests per minute per authenticated admin. It only
resets the attempt counter and schedules the existing worker; HTTP never runs
generation. The next worker starts 30 seconds after API startup and otherwise
runs five minutes after each completed batch, so a successful requeue is not a
promise of immediate processing.

The server atomically accepts a requeue only when the specific row still has no
thumbnail, is unfrozen, and remains at or above the shared eight-attempt limit.
It refuses stale rows and refuses while the thumbnail worker holds its advisory
lock. Every accepted requeue logs the admin actor ID and clip ID. Object names
and storage paths are never exposed by the admin API, including error responses.

Do not reset every exhausted clip periodically: permanently unsupported media
must not create an unlimited processing loop.
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

Cleanup tests inject deterministic per-object outages and lost delete responses,
verify independent progress for original/stored/candidate objects, restart fresh
worker modules and PostgreSQL sessions, and check unbounded retries with capped
backoff. They also cover concurrent claims, missing objects, authorization, and
transaction rollback when cleanup enqueue fails.
