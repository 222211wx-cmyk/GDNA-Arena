---
name: Expo native module boundaries
description: Compatibility rules for native-only crypto and media modules in the Expo mobile artifact.
---

Expo Router eagerly discovers route modules for its web bundle, so a native-only import anywhere in a route dependency can break the entire optional web preview. Keep native media and cryptography behind platform-specific modules with explicit web façades that fail clearly at the feature boundary rather than during app startup.

**Why:** Agora and native cryptography both loaded successfully in native-oriented TypeScript but crashed the Expo web bundle at import time. The crypto package's 0.x line was also explicitly bridged/old-architecture-only while this app enables React Native's New Architecture.

**How to apply:** For future native dependencies, verify architecture support before choosing a version, use the New Architecture/Nitro line when required, and add matching `.web` modules before importing the feature from an Expo Router route.

For Kotlin bridges on React Native 0.81, obtain the activity from
`reactApplicationContext.currentActivity`, not an assumed inherited Kotlin
`currentActivity` property.

**Why:** A release build reached app Kotlin compilation and rejected the inherited
property even though TypeScript and generated-source tests passed. The base module
now declares its deprecated getter in Kotlin, changing synthetic property access.

**How to apply:** Check installed React Native bridge declarations when porting
native snippets; JavaScript checks cannot validate Kotlin API compatibility.