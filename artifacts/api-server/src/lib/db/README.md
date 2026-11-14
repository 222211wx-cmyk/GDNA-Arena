# Database schema workflow

`src/schema/` is the Drizzle source of truth for tables used through Drizzle ORM.
The database also contains legacy runtime tables. Never run an unscoped
`drizzle-kit push`: it may interpret those independent tables as deletion
candidates.

## Clips emergency push workflow

No new migration is generated for this repair. The `push` script is a bounded,
transactional executor. It can only add `clips.is_original_footage`, add
`clip_original_registrations.audio_signature`, or create the expected original
registration table and index when absent. It rejects unexpected target shapes
and never executes inferred Drizzle SQL, drops, renames, or truncations.

1. Validate that committed migration history has not been removed or detached:

   ```sh
   pnpm --filter @workspace/db run validate:history
   ```

2. Apply and verify the allowlisted additive repair:

   ```sh
   pnpm --filter @workspace/db run push
   ```

Do not substitute raw `drizzle-kit push`, do not add `--force`, and do not run `migrate`.
The post-merge hook performs only the static history validation. Replit Publish
manages production schema changes; API production startup performs no schema
DDL.