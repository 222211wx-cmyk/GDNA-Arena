#!/bin/bash
set -e

# Merged task branches frequently add new dependencies, so the lockfile on main
# may lag behind package.json — never use --frozen-lockfile here.
pnpm install --no-frozen-lockfile

# Apply committed, versioned migrations after merged code introduces a new table
# or column. Migrations are non-interactive and never infer destructive changes
# from legacy tables that intentionally live outside the Drizzle schema.
if [ -n "${DATABASE_URL:-}" ]; then
  pnpm --filter @workspace/db run migrate
else
  echo "Skipping dev database migrations: DATABASE_URL is not set."
fi
