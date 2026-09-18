#!/bin/bash
set -e

# Merged task branches frequently add new dependencies, so the lockfile on main
# may lag behind package.json — never use --frozen-lockfile here.
pnpm install --no-frozen-lockfile

# Validate committed SQL history without connecting to or mutating a database.
# Schema changes are pushed explicitly after their SQL preview is reviewed.
pnpm --filter @workspace/db run validate:history
