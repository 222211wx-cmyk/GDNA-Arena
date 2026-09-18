---
name: Chat attachment uploads
description: How AMIS message attachments are stored/served safely; upload security rules
---
Message attachments upload via a login-gated endpoint and are served from a login-gated files route.

**Rules (why: architect flagged stored XSS + disk-exhaustion; local disk is wiped on republish):**
- Stored extension is ALWAYS server-chosen from a strict MIME→ext map (never client filename); SVG/HTML rejected. Serve with explicit Content-Type from that map + nosniff; non image/video/audio get `Content-Disposition: attachment`.
- Per-user rate limit (15 uploads / 10 min). Any new upload endpoint must follow the same pattern.
- Voice notes upload the recorded blob — never send `blob:` object URLs (they fail validation and can't be heard by the peer).
- Frontend must wrap relative `/api/...` attachment URLs through the `api()` base-path helper when rendering (artifact path routing).
- Attachments persist in Replit App Storage (bucket), not local disk — local disk does not survive production republishes. Any new persistent upload feature must use the bucket; an idempotent boot-time migration rescues legacy disk files.

**Image-size policy:** The 5 MB limit is image-specific and applies before browser encryption; do not reduce unrelated attachment limits or omit encryption overhead from transport limits.
**Why:** The requested image sender limits photos, while existing messaging must retain end-to-end encryption and support larger non-image attachments.
**How to apply:** Preserve the existing encrypted attachment pipeline instead of introducing a plaintext image-upload endpoint. A declared encrypted-image type selects an upload policy, but cannot prove the encrypted content's actual MIME type.
