---
name: API generator compatibility
description: Why API regeneration needs explicit library targets in this monorepo
---

Keep the API generator's Zod and React Query targets aligned explicitly with the installed consumer versions rather than relying on automatic package detection.

**Why:** Regenerating an unchanged contract after an Orval update inferred Zod 4 for a Zod 3 consumer and React Query 4 for a React Query 5 consumer. Generation succeeded, but the emitted validators did not compile. Newer fetch helpers also need DOM iterable types.

**How to apply:** When updating the generator or regenerating contracts, check the actual consumer versions and run the shared-library typecheck. Fix generator configuration rather than patching generated output or replacing the consumer libraries.