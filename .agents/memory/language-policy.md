---
name: Language policy
description: Canonical language set and first-visit behavior for GDNA Arena.
---

Customer-facing language controls must preserve the five foundational languages: Arabic, English, French, Spanish, and German. Arabic is the default for a first visit; a citizen's explicit language choice should persist across reloads.

**Why:** The owner confirmed that AR/EN/FR/ES/DE have been a project foundation since the original build and feature/style work must never remove them.

**How to apply:** Reuse the shared language context and translation dictionaries in every shared or module-specific header. Tests may exercise a subset, but all five languages must remain exposed.