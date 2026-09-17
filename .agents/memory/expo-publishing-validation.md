---
name: Expo publishing validation
description: Validate native production bundles when diagnosing a shared web/mobile publish.
---

Verify the native mobile production build before declaring a shared release ready; web/API builds and TypeScript checks alone are insufficient.

**Why:** A release targeting the website also built the registered mobile artifact, where a broken dependency link failed native Babel transformation despite successful web/API compilation.

**How to apply:** Inspect the actual Metro error response, not just its generic HTTP status or the entry filename. Check the installed Expo compatibility list before changing router versions. Native bundle, manifest, and asset generation provide the relevant release check.

Standalone Expo production export can validate native bundle transforms without starting another HTTP Metro server.

**Why:** The custom publishing build can collide with a different managed service's development port, although native compilation itself is valid. Avoid stopping unrelated services just to clear that port.

**How to apply:** Distinguish a port/startup failure in local release tooling from an actual bundle error. An iOS/Android production export validates native bundles, but does not prove the complete custom publishing process succeeded.