---
name: pnpm install-script policy compatibility
description: pnpm 10.26.1 treats denied build-script version selectors differently from approved ones.
---

For pnpm 10.26.1, use separate exact-version entries when explicitly denying dependency lifecycle scripts. Do not combine denied versions with `||`.

**Why:** Its allow-list expands version selectors, but its ignored-build filtering compares literal dependency paths or package names. A combined deny selector can therefore still trigger `ERR_PNPM_IGNORED_BUILDS` under strict dependency-build enforcement.

**How to apply:** Check the publishing runner's actual pnpm version and implementation before changing script policy. Preserve strict enforcement and narrowly scoped decisions rather than permitting scripts or disabling the check just to make publishing pass.