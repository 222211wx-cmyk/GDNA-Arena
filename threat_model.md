# Threat Model — GDNA Arena / EMPIRE ETERNAL

## Project Overview

A Node.js/Express play-to-earn crypto gaming platform. Users register, compete in mini-games, earn coins/XP, claim daily rewards, chat with an AI assistant (GDN-AI, powered by GPT-4o), exchange messages with other users, and upload audio/video content to a monetised media platform (GlobalStar). Deployed publicly at `helixly.app` on Replit autoscale. Stack: Express 5, PostgreSQL + Drizzle ORM, express-session (server-side), React + Vite frontend.

## Assets

- **User credentials & sessions** — email, bcrypt-hashed passwords, express-session cookies. Compromise allows account takeover.
- **Coin/XP balances & transaction history** — game rewards, daily claims, wallet entries. Manipulation is a direct business loss.
- **Private messages (AMIS/DMs)** — per-user direct messages and group chats. Leakage is a privacy violation.
- **Media uploads (GlobalStar)** — user-uploaded audio/video. Platform pays real MAD/USD per view; earnings feed a withdrawal system.
- **Application secrets** — `SESSION_SECRET`, `DATABASE_URL`, `OPENAI_API_KEY`. Leakage of the OpenAI key allows unbounded API spend; session secret allows session forgery.
- **Admin capabilities** — `is_admin` flag gates council reports and privileged endpoints. Escalation gives full platform control.

## Trust Boundaries

- **Browser → API** — All client requests cross this boundary. Session cookie is the auth token. Every sensitive action must be gated on `req.session.userId` server-side.
- **API → PostgreSQL** — Direct pool connection. SQL injection at API layer = full DB access.
- **API → OpenAI** — Server calls GPT-4o with the platform's API key. Unauthenticated routes that call OpenAI turn every anonymous visitor into a cost center.
- **API → Replit App Storage (GCS)** — Media and chat attachments stored in GCS bucket. File-serving endpoints must authenticate callers before proxying content.
- **Authenticated ↔ Unauthenticated** — Games, wallet, DMs, daily rewards, and all write operations require login. Public surfaces: leaderboard, citizen profiles, media browse. The boundary must be enforced server-side.
- **User ↔ Admin** — Admin flag gates council/report APIs. Checked via direct DB lookup, not client claim.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/app.ts` (middleware stack), `artifacts/api-server/src/routes/index.ts` (route mount)
- **Highest-risk areas:**
  - `artifacts/api-server/src/routes/chat.ts` — unauthenticated OpenAI access, unvalidated history injection
  - `artifacts/api-server/src/routes/empire-media.ts` — unauthenticated stream/download, view-fraud via XFF spoofing
  - `artifacts/api-server/src/routes/auth.ts` — registration, login, GDPR erasure
  - `artifacts/api-server/src/routes/messages.ts` — DM access control, file upload
- **Public vs authenticated vs admin:** Most read-only routes (leaderboard, profiles, media browse) are public. All write/financial/DM endpoints require session. Admin routes check `is_admin` from DB.
- **Dev-only areas:** `artifacts/mockup-sandbox/` (Canvas design tool), `artifacts/gdna-arena-mobile/` (Expo companion app) — mobile server is a static file server for the Expo build, not a production API.

## Threat Categories

### Spoofing / Authentication

Users authenticate with email + password; sessions are stored server-side in PostgreSQL. Session cookies are `httpOnly`, `sameSite: lax`, `secure: auto` (HTTPS in production). The session secret is enforced from env in production (`process.exit(1)` if missing). No JWT, no client-stored tokens.

**Guarantee required:** All endpoints that access user-specific data or perform financial operations MUST check `req.session.userId` before proceeding. The current gap: `POST /api/chat` and `POST /api/chat/stream` accept OpenAI calls from unauthenticated users.

### Tampering

Coin and XP changes go through DB transactions; client-supplied amounts are never trusted (noted in `replit.md`). Game outcomes are computed server-side. The view-count increment for GlobalStar uploads uses the leftmost `X-Forwarded-For` value, which is attacker-controlled, allowing earnings inflation.

**Guarantee required:** IP-based deduplication for financial operations MUST use `req.ip` (which Express resolves via `trust proxy` logic), not raw `X-Forwarded-For` header parsing.

### Information Disclosure

Private DM messages are scoped to room members (membership checked before message fetch). User-uploaded media (GlobalStar) is served without any authentication check on stream and download endpoints, making all uploaded content publicly readable by enumeration of sequential integer IDs.

**Guarantee required:** `GET /api/gs/uploads/:id/stream` and `/download` MUST verify the caller is authenticated (and optionally is the uploader or a paying viewer) before serving file content.

### Elevation of Privilege

Admin flag is checked via direct DB lookup on sensitive endpoints. Games and financial routes check session auth before executing. History items in the AI chat are spread into the OpenAI messages array without role validation, allowing injected `system`-role messages to override the server's system prompt.

**Guarantee required:** Client-supplied OpenAI history MUST have roles validated to `user | assistant` only, with per-item content filtering, before inclusion in API calls.

### Denial of Service / Cost Abuse

Rate limits are in place: auth endpoints (20 failed/15 min), AI endpoints (30/5 min), global API (600/5 min). However, the AI chat endpoints require no authentication, allowing distributed cost abuse at the platform's OpenAI expense. The chat upload rate limiter uses an in-memory Map that resets on process restart.

**Guarantee required:** AI chat endpoints MUST require a valid session. Per-user upload rate limits SHOULD be persisted in the database or a shared store rather than in-memory.
