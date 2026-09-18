# Clip storage reconciliation and approved orphan cleanup

Reconciliation is a read-only operator inventory. It does not apply changes,
enqueue cleanup, run from a worker or API startup hook, perform a runtime
migration, or access fingerprints.

From the workspace root:

```sh
pnpm --filter @workspace/api-server run clips:reconcile -- --output /tmp/clip-reconciliation.json
```

The package runner may strip the optional `--` separator. `--output` is required
and must name a new file; the command will not overwrite an existing file.
`--min-age-days` defaults to 30 and cannot be less than 30. `--max-objects`
defaults to 100000.

## Scope and conservative holds

The command recursively lists only the configured clips prefix. It does not scan
the rest of the bucket or download clip contents. After inventory completes, it
reads every clip row, including frozen clips, and the ordinary
`clip_storage_cleanup` deletion queue in a `REPEATABLE READ READ ONLY`
transaction.

It protects every live original and stored thumbnail, the deterministic retry
name for every live clip, and any retry name containing an extant clip ID.
All `.uploads/` paths and names beginning `clip_upload_` are held regardless of
age or state.

Only these known legacy shapes can become candidates:

- `clip_<32hex>.(mp4|mov|webm)`
- `thumb_<32hex>.jpg`
- `thumb_retry_<id>_<32hex>.jpg`

A candidate must have a valid generation, size, creation time, update time, and
metageneration, and both timestamps must be at least the configured age.
Unknown names, uncertain metadata, resumable paths, and objects already in the
ordinary deletion queue are held. This is deliberately not full garbage
collection.

The report records `startedAt`, `generatedAt`, scope, every disposition and
reason, candidates, and summary counts. Incomplete listing or database errors
fail nonzero and produce no report. A report is evidence for review, **not
deletion authorization**.

## Optional ownership binding

Approved cleanup is unavailable until an external operator manually installs
[`clip-storage-cleanup-setup.sql`](clip-storage-cleanup-setup.sql). Stop every API
and worker replica first and run the file as the owner of `public.clips`. It is
idempotent and intentionally is never run by application startup. Ordinary clip
publication continues to work when this optional SQL has not been installed.
The installer creates no ownership row.

The operator must upload a marker object outside the clips prefix. Its content,
at most 4 KiB, is exactly:

```json
{"databaseId":"a UUID","databaseName":"the database name","bucket":"the bucket","prefix":"the clips prefix"}
```

Obtain `marker_generation` from the bucket after upload. Then insert exactly one
`clip_storage_owner` row (`singleton = true`) with the same `database_id`,
`database_name`, `bucket`, `prefix`, the outside-prefix `marker_name`, pinned
`marker_generation`, and a PEM-encoded Ed25519 **public** key. There is no
automatic population or discovery. The private key must never be placed in the
workspace, application environment, database, object bucket, or command
history.

When configured ownership is present, report generation includes the database
identity and marker generation from that row, checking the actual database name.
This report binding is not itself proof of bucket ownership. Before enqueue and
each deletion attempt, the separate executor verifies the configured storage scope,
reads the marker metadata, and downloads the marker pinned to its exact generation.
It rejects a marker over 4 KiB or any generation or JSON field mismatch.
An optional owner read may establish that ownership is not configured, but such
an unbound report cannot authorize approved cleanup.

## Separate signed approval

Review a newly generated report offline. Hash the exact report file bytes with
SHA-256. The separately created approval payload is exact JSON bytes with this
shape:

```json
{
  "schemaVersion": 1,
  "action": "delete-reviewed-clip-generations",
  "approvalId": "a UUID",
  "approvedBy": "a nonempty operator identity",
  "approvedAt": "an ISO timestamp",
  "expiresAt": "an ISO timestamp",
  "reportSha256": "64 lowercase hexadecimal characters",
  "databaseId": "the configured UUID",
  "databaseName": "the configured database name",
  "bucket": "the configured bucket",
  "prefix": "the configured clips prefix",
  "markerGeneration": "the pinned marker generation",
  "objects": [
    {
      "name": "exact object name",
      "generation": "exact generation",
      "size": "exact byte size",
      "timeCreated": "ISO timestamp",
      "updated": "ISO timestamp",
      "metageneration": "exact metageneration"
    }
  ]
}
```

Every object entry must exactly equal a candidate in the hashed report.
`approvedBy` cannot be empty. Approval validity cannot exceed 24 hours, and
execution requires both report timestamps (`startedAt` and `generatedAt`) to be
no more than 24 hours old. `approvedAt`/`expiresAt` and report timestamps must
also be internally ordered and currently valid.

Sign the exact, unchanged payload bytes offline. For example, with a private key
held on an operator-controlled machine:

```sh
openssl pkeyutl -sign -rawin \
  -inkey /secure/offline/clip-cleanup-ed25519.pem \
  -in approval-payload.json |
  openssl base64 -A > signature.b64

jq -n \
  --arg payload "$(openssl base64 -A -in approval-payload.json)" \
  --arg signature "$(cat signature.b64)" \
  '{payload:$payload,signature:$signature}' > approval-wrapper.json
```

The supplied approval file is only this wrapper:

```json
{"payload":"base64 of exact JSON payload bytes","signature":"base64 Ed25519 signature"}
```

Do not pretty-print, normalize, or reconstruct the payload after signing.

## Manual execution and locking

Automatic bucket cleanup is never installed. Only this explicit command may
process reviewed work:

```sh
pnpm --filter @workspace/api-server run clips:cleanup-approved -- \
  --report /secure/reconciliation.json \
  --approval /secure/approval-wrapper.json \
  --execute-approved-generations
```

Reviewed objects go only to `clip_orphan_cleanup`; they must **never** be inserted
into the ordinary `clip_storage_cleanup` queue, whose existing worker deletes by
name without enforcing a reviewed generation.

For fresh checks and enqueue, the executor starts a transaction and acquires
locks in this order:

```sql
LOCK TABLE public.clips IN EXCLUSIVE MODE;
LOCK TABLE public.clip_storage_cleanup IN SHARE ROW EXCLUSIVE MODE;
```

It then revalidates ownership, marker bytes and pinned generation, every
database reference, report and approval age/hash/signature, and every object's
pinned storage metadata before inserting pending rows and audit records. It
commits those durable tombstones before attempting storage deletion.

Before **each** generation-pinned delete, a new transaction takes the same two
locks in the same order and repeats all current ownership, reference, and object
metadata checks. The locks remain held through that delete's outcome and audit
commit. `EXCLUSIVE` blocks publication and thumbnail row-lock transactions;
`SHARE ROW EXCLUSIVE` blocks the ordinary cleanup worker's retry updates. A
timeout or uncertainty is a failed attempt, not permission to weaken a check.

The trigger rejects any future clip original or thumbnail name matching any
`clip_orphan_cleanup` row, regardless of `pending`, `deleted`, or `rejected`
state. Rows are immutable name tombstones after enqueue commit and must not be
removed after success, rejection, timeout, or a changed decision.

The same command is safe to repeat: it resumes pending entries using durable
attempt counts, outcomes, and backoff, and generation-pinned deletion makes an
already-missing approved generation successful. If the approval or report has
expired, execution fails closed. Generate a fresh report and obtain a new
signature; an operator may reauthorize the same exact object only when it is
still a candidate in that fresh report.

## Privileges and audit

The setup script revokes PUBLIC DML on `clip_storage_owner`,
`clip_orphan_cleanup`, and `clip_orphan_cleanup_audit`, and PUBLIC use of the
audit sequence. Keep table and function ownership on a trusted, non-login
administrative role.

Grant the application its existing rights on `clips`; do not grant it DML on
the ownership, reviewed queue, or audit tables. The trigger is `SECURITY
DEFINER`, uses a fixed safe `search_path`, and reads the fully qualified
tombstone table through its trusted owner, so restricted application writers do
not need direct tombstone-table access.

Use a dedicated executor/operator role. Grant it only ownership read,
reviewed-queue read/insert, column-specific update needed for reauthorization
and retry (`approval_sha256`, `report_sha256`, `approval`, `expected`, `state`,
`attempts`, `retry_at`, and `last_outcome`), audit read/insert plus audit-sequence
usage, storage credentials, and the existing-table privileges required to read
and take the documented locks on `clips` and `clip_storage_cleanup`. Never grant
it update of `object_name`, `generation`, or `created_at`, or deletion of a
reviewed row. Record enqueue, reauthorization, retry, rejection, storage result,
and final deletion as append-only audit events; `db_actor` defaults to
`session_user`, preserving the invoking executor identity.

Provisioning and approved cleanup were not run against the application's database
or real object storage. Safety tests use an isolated PostgreSQL cluster and a fake
bucket; installing this optional setup and executing signed approvals remain
separate operator actions.