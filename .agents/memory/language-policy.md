---
name: Language policy
description: Canonical language set and first-visit behavior for GDNA Arena.
---

Customer-facing language controls must preserve the five foundational languages: Arabic, English, French, Spanish, and German. Arabic is the default for a first visit; a citizen's explicit language choice should update the visible interface immediately and persist across reloads and navigation.

**Why:** The owner confirmed that AR/EN/FR/ES/DE have been a project foundation since the original build and feature/style work must never remove them.

**How to apply:** Reuse the shared language context and authored translation dictionaries in every page and shared/module-specific header. Keep all five languages exposed; switch document direction to RTL only for Arabic, while EN/FR/ES/DE use LTR.