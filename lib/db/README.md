# Database schema workflow

`src/schema/` is the Drizzle source of truth for tables used through Drizzle ORM.
The database also contains legacy tables created by API startup SQL, so do not
run `drizzle-kit push` directly: it may interpret those independent tables as
deletion candidates.

## After changing a Drizzle schema

1. Generate a migration:

   ```sh
   pnpm --filter @workspace/db run generate --name=<short-change-name>
   ```

2. Review the generated SQL in `lib/db/drizzle/`. Commit the schema, SQL
   migration, and updated snapshot together.

3. Apply it to the development database:

   ```sh
   pnpm --filter @workspace/db run migrate
   ```

Pending migrations run automatically from `scripts/post-merge.sh` after merged
code is installed when `DATABASE_URL` is available. Migrations are intentionally
not forced: destructive changes must be written and reviewed explicitly.

These commands target the development database only. Replit Publish compares
development and production schemas and applies the production diff; do not add
database mutation commands to API startup or deployment build scripts.