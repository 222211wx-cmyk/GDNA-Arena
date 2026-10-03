---
name: Owner verification restriction
description: Running tests requires a changed instruction from the owner.
---

Do not run tests without a changed instruction from the owner.

**Why:** The owner has expressly forbidden running tests; this restriction was reiterated in the older-message history assignment.

**How to apply:** Do not launch test commands or browser-testing agents, and explicitly skip automated completion validation that would run tests. Describe verification limits accurately rather than claiming tested behavior.