---
name: Optional AI policy
description: Keep core app availability independent of AI credentials and billing.
---

AI is optional for GDNA Arena. Missing credentials or exhausted credits must not prevent startup or ordinary non-AI features. Use explicit unavailable responses or existing deterministic fallbacks; do not automatically connect a different paid AI provider.

**Why:** The owner removed the OpenAI key and explicitly prioritized a working app without funding AI. Automatically replacing the provider would contradict that intent.

**How to apply:** Preserve this separation when adding AI routes or scheduled work. Do not claim generated reports or persist invented embeddings when a provider is unavailable.