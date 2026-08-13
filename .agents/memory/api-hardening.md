---
name: API hardening
description: Security middleware layout on the api-server and constraints to respect
---

- app.ts order: helmet (CSP off — API only; CORP cross-origin so media loads) → rate limiters → session. `trust proxy` is 1 (Replit router) — required for real client IPs in rate limiting and `secure: "auto"` cookies in production.
- Tiered limits: /api/auth/login|register 10/15min per IP (Arabic 429 message), AI routes (/api/smart, /api/archon, /api/chat, /api/neural, /api/ameeq) 30/5min, all /api 600/5min.
- **Why:** owner explicitly demanded hardened protection ("empire must not be breached"), and AI endpoints burn OpenAI credit if farmed.
- **How to apply:** new expensive/AI routes should be added to the aiLimiter path list; don't lower the auth limiter without owner sign-off; production logs an error if SESSION_SECRET is missing.
