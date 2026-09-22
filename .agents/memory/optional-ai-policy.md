---
name: Optional AI policy
description: Keep core app availability independent of AI credentials and billing.
---

AI is optional for ordinary GDNA Arena functionality. Missing credentials or exhausted credits must not prevent startup or ordinary non-AI features. Use explicit unavailable responses or clearly labeled deterministic fallbacks; do not automatically connect a different paid AI provider.

**Why:** The owner previously removed the OpenAI key and prioritized a working app without funding AI. On 2026-09-21, the owner explicitly approved OpenAI through Replit credits for GDNA CORE with consumption limits. That scoped approval supersedes the earlier refusal for CORE, not for unlimited autonomous background AI.

**How to apply:** Keep managed CORE requests bounded by durable daily quotas and token limits. Do not enable legacy autonomous paid jobs merely because CORE is enabled. Preserve ordinary availability when billing/provider access fails. Do not claim generated reports or persist invented embeddings when a provider is unavailable.