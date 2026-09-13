---
name: Expo publishing validation
description: Validate native production bundles when diagnosing a shared web/mobile publish.
---

Verify the native mobile production build before declaring a shared release ready; web/API builds and TypeScript checks alone are insufficient.

**Why:** A release targeting the website also built the registered mobile artifact, where a broken dependency link failed native Babel transformation despite successful web/API compilation.

**How to apply:** Inspect the actual Metro error response, not just its generic HTTP status or the entry filename. Check the installed Expo compatibility list before changing router versions. Native bundle, manifest, and asset generation provide the relevant release check.