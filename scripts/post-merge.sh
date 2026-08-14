#!/bin/bash
set -e

# Merged task branches frequently add new dependencies, so the lockfile on main
# may lag behind package.json — never use --frozen-lockfile here.
pnpm install --no-frozen-lockfile

# NOTE: no drizzle-kit push step — this project applies schema via raw DDL that
# runs on api-server startup (see artifacts/api-server/src/app.ts).
