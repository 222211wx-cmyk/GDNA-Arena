---
name: Security release policy
description: Owner's audit gate and dependency remediation constraints
---

Do not republish until a clean audit has been shown to the owner.

**Why:** On 2026-10-03 the owner explicitly required this gate after reporting public exposure and billing concerns.

**How to apply:** Report actual remaining findings, including advisories without available patches. Never suppress advisories to claim zero high findings or treat source privacy as equivalent to taking the deployment offline.

Review overlapping pnpm audit-fix overrides before trusting the result.

**Why:** Generated overlapping ranges left vulnerable transitive versions resolved even after adding newer broad overrides; removing conflicting selectors was necessary.

**How to apply:** Inspect the resolved lockfile and run the audit after installation. Preserve compatible major branches where possible, and check shared React type identity after workspace-wide resolution.