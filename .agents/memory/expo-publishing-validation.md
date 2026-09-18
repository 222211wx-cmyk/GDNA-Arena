---
name: Expo publishing validation
description: Validate native production bundles when diagnosing a shared web/mobile publish.
---

Verify the native mobile production build before declaring a shared release ready; web/API builds and TypeScript checks alone are insufficient.

**Why:** A release targeting the website also built the registered mobile artifact, where a broken dependency link failed native Babel transformation despite successful web/API compilation.

**How to apply:** Inspect the actual Metro error response, not just its generic HTTP status or the entry filename. Check the installed Expo compatibility list before changing router versions. Native bundle, manifest, and asset generation provide the relevant release check.

Standalone Expo production export can validate native bundle transforms without starting another HTTP Metro server.

Background media capabilities require an installed native build and physical-phone checks; Expo Go, browser screenshots, and Hermes exports are not evidence of locked-screen playback.

**Why:** Background entitlements and Android media services are native build configuration, while operating systems govern interruptions and lock-screen behavior.

**How to apply:** Report bundle, emulator, and physical-device results separately. Rebuild the native app after media plugin changes and verify lock, app switching, system controls, and interrupted/expired-source recovery on both platforms before promising phone behavior.

**Why:** The custom publishing build can collide with a different managed service's development port, although native compilation itself is valid. Avoid stopping unrelated services just to clear that port.

**How to apply:** Distinguish a port/startup failure in local release tooling from an actual bundle error. An iOS/Android production export validates native bundles, but does not prove the complete custom publishing process succeeded.