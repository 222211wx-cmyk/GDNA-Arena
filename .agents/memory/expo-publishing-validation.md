---
name: Expo publishing validation
description: Validate native production bundles when diagnosing a shared web/mobile publish.
---

Verify the native mobile production build before declaring a shared release ready; web/API builds and TypeScript checks alone are insufficient.

**Why:** A release targeting the website also built the registered mobile artifact, where a broken dependency link failed native Babel transformation despite successful web/API compilation.

**How to apply:** Inspect the actual Metro error response, not just its generic HTTP status or the entry filename. Check the installed Expo compatibility list before changing router versions. Native bundle, manifest, and asset generation provide the relevant release check.

Standalone Expo production export can validate native bundle transforms without starting another HTTP Metro server.

Declare Babel presets referenced by app configuration as direct app dependencies; local bundle success does not prove clean EAS resolution.

**Why:** An SDK upgrade exported locally but EAS could not resolve the Expo Babel preset under pnpm's isolated dependency layout. The generic Gradle Node failure hid the missing module.

**How to apply:** Read the first Metro transformer error in full EAS logs. Match the preset to the installed Expo version and update the lockfile; do not replace native libraries or downgrade Gradle to fix a missing JS module.

Validate the release API origin from EAS build-profile variables, not the local
preview workflow or Replit publishing environment.

**Why:** A signed EAS APK compiled successfully without the public API origin;
the native API client then rejected all server requests. Preview and website
publishing injected that origin separately, masking the mobile release failure.

**How to apply:** Obtain the current published URL through deployment metadata,
configure the public origin for EAS, and exercise API URL resolution with
`__DEV__=false` before building. Compilation and signing are not connectivity tests.

Background media capabilities require an installed native build and physical-phone checks; Expo Go, browser screenshots, and Hermes exports are not evidence of locked-screen playback.

**Why:** Background entitlements and Android media services are native build configuration, while operating systems govern interruptions and lock-screen behavior.

**How to apply:** Report bundle, emulator, and physical-device results separately. Rebuild the native app after media plugin changes and verify lock, app switching, system controls, and interrupted/expired-source recovery on both platforms before promising phone behavior.

**Why:** The custom publishing build can collide with a different managed service's development port, although native compilation itself is valid. Avoid stopping unrelated services just to clear that port.

**How to apply:** Distinguish a port/startup failure in local release tooling from an actual bundle error. An iOS/Android production export validates native bundles, but does not prove the complete custom publishing process succeeded.

The custom publishing builder must allocate its own temporary Metro port and pass it consistently to readiness, bundle, manifest, and asset requests. Never reuse a preview packager or stop another service to free port 8081. Verify the Metro status body, not just HTTP 200, and fail promptly if the child exits. Full workspace builds reproduced a collision with the mockup preview; isolated temporary-port builds successfully produced both native bundles and assets.
