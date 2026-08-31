---
name: Language policy
description: Canonical language set and first-visit behavior for GDNA Arena.
---

Customer-facing language controls must offer Arabic, English, and French only. Arabic is the default for a first visit; a citizen's explicit language choice should persist across reloads.

**Why:** The owner explicitly standardized the product on AR/EN/FR and requested Arabic as the default without changing the established visual system.

**How to apply:** Reuse the shared language context and translation dictionaries in every shared or module-specific header. Keep legacy translations internally only when needed for compatibility; do not expose extra languages in switchers.