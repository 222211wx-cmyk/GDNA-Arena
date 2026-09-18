# Clip storage reconciliation

This is a read-only operator inventory. It does not apply changes, enqueue
cleanup, run from a worker or API startup hook, perform a runtime migration, or
access fingerprints.

From the workspace root:

```sh
pnpm --filter @workspace/api-server run clips:reconcile -- --output /tmp/clip-reconciliation.json
```

The package runner may strip the optional `--` separator. `--output` is required
and must name a new file; the command will not overwrite an existing file.
`--min-age-days` defaults to 30 and cannot be less than 30.
`--max-objects` defaults to 100000.

## Scope and conservative holds

The command recursively lists only `PRIVATE_OBJECT_DIR/clips`. It does not scan
the rest of the bucket or download object contents. After inventory completes,
it reads all clip rows, including frozen clips, and the cleanup queue in a
`REPEATABLE READ READ ONLY` transaction.

It protects:

- every live original and stored thumbnail;
- the deterministic retry name for every live clip;
- any retry name containing an extant clip ID, even if it is not the currently
  deterministic name.

All `.uploads/` paths and all names beginning `clip_upload_` are held regardless
of age or state. This deliberately protects resumable uploads without parsing
manifests; old resumable outputs being held is expected.

Only these known legacy shapes can become candidates:

- `clip_<32hex>.(mp4|mov|webm)`
- `thumb_<32hex>.jpg`
- `thumb_retry_<id>_<32hex>.jpg`

A candidate must have valid generation, size, creation time, and update time,
and both timestamps must be at least the configured age. Unknown names and
missing or invalid metadata are held. Objects already present in the cleanup
queue are excluded.

## Report and failure behavior

The JSON report records the scope and generated timestamp, every inventoried
object's disposition and reason, the candidate list, and summary counts.
Incomplete storage listing or database errors fail nonzero and produce no
report. No live production scan was performed while preparing this
documentation.

The report is evidence for review, **not executable authorization**. There is no
apply or enqueue mode, and no automatic bucket-wide deletion. The current
cleanup worker deletes an object name unconditionally and cannot consume or
enforce report generations.

Before any separately authorized future enqueue or deletion, an operator must:

1. confirm ownership of the correct database and bucket environment;
2. explicitly approve each exact object name and generation;
3. quiesce clip publication and thumbnail retries;
4. rerun reconciliation and recheck current database references and object
   metadata immediately before acting.

Because resumable paths, unknown names, and uncertain metadata are intentionally
held, this inventory is not full garbage collection.