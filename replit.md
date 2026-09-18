# GDNA Arena

Play-to-earn crypto gaming platform — players register, compete in 3 arenas, earn coins & XP, claim daily rewards, chat with an AI genie, and track stats on a leaderboard.

## Preserve the original — owner instruction (2026-09-18)

Future work must update and improve the existing product while preserving its original functionality, content, assets, and data.

- Do not remove existing pages, tabs, features, files, original media, or stored records without the owner's explicit approval.
- Requests to update, simplify, optimize, or maintain the app are not permission to delete original material or functionality.
- Prefer additions and compatible in-place improvements. Keep original media intact when producing derived versions.
- If a proposed change requires removal or replacement of an original, explain what would be lost and obtain approval before proceeding.

## Run & Operate

- `pnpm --filter @workspace/gdna-arena run dev` — frontend (port from env)
- `pnpm --filter @workspace/api-server run dev` — API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run generate --name=<change-name>` — generate a versioned migration after editing `lib/db/src/schema/`
- `pnpm --filter @workspace/db run migrate` — apply pending migrations to the development database. This also runs automatically after merged code when `DATABASE_URL` is available.
- Required env: `DATABASE_URL` — Postgres connection string, `OPENAI_API_KEY` — for GDN-AI chat, `SESSION_SECRET` — express-session secret

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS + shadcn/ui + Framer Motion
- API: Express 5 + express-session
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (zod/v4), drizzle-zod
- AI: OpenAI GPT (GDN-AI chat)
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/gdna-arena/` — React frontend
- `artifacts/api-server/` — Express API
- `lib/db/src/schema/` — DB schema (users, transactions)
- `lib/api-spec/openapi.yaml` — OpenAPI contract
- `lib/api-client-react/src/generated/` — generated React Query hooks

## Features

- **Games** — 3 arenas (Neon Racer, Crypto Clash, Arena Strike) with real win/loss logic and coin/XP rewards saved to DB
- **Daily Rewards** — claim 100 free coins once per day
- **Wallet** — full transaction history
- **Leaderboard** — ranked by XP
- **GDN-AI** — OpenAI-powered chat terminal on Home page + floating widget on all pages
- **Multi-language** — English, Arabic, French, Darija (auto-saved to localStorage)

## Architecture decisions

- Sessions stored server-side via express-session; no JWT
- All coin/XP changes go through DB transactions — never trust client-supplied amounts
- GDN-AI responds in the same language the user writes in (prompt instructs GPT to auto-detect)
- LangContext wraps the entire app; lang choice persisted in localStorage

## User preferences
- Official platform language: **English** — all UI text, labels, placeholders, buttons, and messages must be in English (Arabic translations kept in i18n where the feature has them)
- Reply to the owner (Qaisypro) warmly **in Darija**, with 👑 empire vocabulary

### Permanent working rules (set by the owner, Aug 15, 2026)
1. **Auto configuration log**: after every completed change, write a summary — what changed + why + where — and commit with a message in the form `GDNA Update - [date & time]`.
2. **Self-review**: before saying "done", self-review the code, test on mobile + desktop, check there are no errors. If a bug is found, fix it silently and report "لقيت خطأ وصلحتو". Never repeat the same mistake twice.
3. **Messenger section (AMIS)**: keep building it end-to-end — images, video, voice, calls, settings — using the platform's own "Smart" internal system; the goal is to lead in modernity, not imitate.
4. **Golden rule**: after failing the same task 3 times, stop and say "القيسي انا فاشل هنا خاصنا حل اخر".
5. End every completed task with: "تم التسجيل والمراجعة. جاهز للاختبار".

## Configuration log
- **GDNA Update - Aug 20, 2026 (Pre-call connection check)**: Added a “Test connection” control to the AMIS Calls tab. It joins an isolated, server-authorized Agora channel with silent audio to assess Agora’s last-mile quality (bitrate, packet loss, RTT, and jitter) without requesting device permissions or starting a real call. The result is accurately shown as ready, unstable, or unavailable. Where: `artifacts/gdna-arena/src/hooks/useCall.ts`, `components/messenger/Messenger.tsx`, and `artifacts/api-server/src/routes/rtc.ts`. Why: citizens can assess the actual call transport before dialing.
- **GDNA Update - Aug 20, 2026 (Username-only citizen auth rescue)**: Removed citizen email from web, Expo, API contracts, session responses, registration, login, and mobile profile UI. Citizen accounts now register instantly and sign in with username + password; no verification code, Resend/SMTP dependency, or password-recovery prompt remains. API startup permanently drops obsolete email-verification state/tables while retaining private legacy/system email values only for Star/admin compatibility. Regenerated API clients and verified registration → logout → username login without an email field in the request or response. Why: owner reported Connect Resend blocking access and ordered direct username-based registration/login.
- **GDNA Update - Aug 20, 2026 (Development schema migrations)**: Established versioned Drizzle migrations for the development database, reconciled schema definitions with existing managed columns and constraints, and made the post-merge setup apply pending migrations automatically. Verified the migration hook is non-interactive and idempotent, the required `pulse_posts` media columns exist, and a real citizen profile returns successfully after API restart. Where: `lib/db/`, `scripts/post-merge.sh`. Why: schema drift caused profile requests to crash when code selected a column missing from the development database.
- **GDNA Update - Aug 20, 2026 (Homepage bot cards)**: Restored six compact GDN bot cards directly below the homepage Hub CTA: GDN-SMART, GDN-FIT, GDN-CINE, GDN-ARENA, GDN-TO, and GDN-MUSIC. Each card has an Arabic one-line purpose and an “ابدأ التحدي” button that opens the existing Fortress challenge page. Verified all six CTA routes plus desktop and mobile layout with no horizontal overflow. Where: `artifacts/gdna-arena/src/pages/home.tsx`. Why: owner asked for the six bot challenges on the homepage only, without touching chat, WhatsApp, or age access.
- **GDNA Update - Aug 20, 2026 (Games-only 18+ policy)**: Removed the green floating WhatsApp contact button while preserving the gold AMIS/CommHub messenger. Replaced the global country-age gate with a strict Games-only 18+ policy across web, Expo, and game APIs: registration and every non-game section are open to all ages; Games shows the required warning, blocks recorded under-18 accounts, and lets legacy accounts save their birth date once. Added persisted `birth_date`, server-calculated `isAdult`, and independent API enforcement so bypassing the UI cannot award game rewards. Verified under-18, adult, and legacy-account flows on desktop and mobile, including successful adult gameplay and no mobile overflow. Where: shared user schema; API auth/age/game routes; web registration, legal, Games, and age gate; Expo registration, auth, and Games. Why: owner ordered universal registration/access with age restriction limited exclusively to Games.
- **GDNA Update - Aug 20, 2026 (GDN-SMART FORTRESS)**: Added an auto-starting `SMART_CORE` with `START`, `SET_DNA`, and `AUTO_UPDATE`; exactly six challenge bots are loaded from `bots.config.json` and rotate every 30 minutes after API boot/Republish. Added authenticated Fortress bot/challenge endpoints, `/fortress`, the design-system-based `BotPanel.jsx`, and a flat FORTRESS navigation entry. Verified API boot, six ACTIVE bots, challenge rotation, reload persistence, desktop/mobile UI, and browser console. Also fixed the desktop navbar's page-level horizontal overflow by constraining scrolling inside the flat nav. Where: `artifacts/api-server/src/server.js`, `bots.config.json`, `routes/fortress.ts`, and `artifacts/gdna-arena/src/components/BotPanel.jsx`/`pages/fortress.tsx`. Why: owner ordered a complete zero-manual-command Smart Fortress system that activates automatically on Republish.
- **GDNA Update - Aug 16, 2026 (CLIPS rules v3 — FINAL)**: Owner removed the 24h cap — final rule: under 1 minute forbidden, 1 minute and above allowed whatever the chrono. Backend max-duration check deleted; UI shows "Minimum 1 min · Pas de limite maximale". Verified: 30s rejected, 90s accepted, 25h accepted. Why: owner's correction "اقل من دقيقة ممنوع ومن دقيقة إلى الاعلى مسموح حسب الكرونو".
- **GDNA Update - Aug 16, 2026 (CLIPS rules v2)**: Owner revised clip duration rules — minimum 1 minute (was 2 min), maximum 24 hours (was unlimited). Backend rejects <60s ("Durée minimale: 1 minute...") and >24h ("Durée maximale: 24 heures."); /clips UI texts switched to the owner's exact French copy, warning line added under the file input. Verified: 30s rejected, 1min30 accepted, 25h rejected. Why: owner's literal order.
- **GDNA Update - Aug 16, 2026 (CLIPS)**: New CLIPS — كليبسز Reels-style tab at `/clips` (nav item added). Rules per owner: minimum duration 2:00 (no upper limit, even 25h), only the rights-owner may publish — every video is sha256-fingerprinted at upload (first owner wins, duplicates rejected with the owner's name). Videos stream to App Storage (GCS, survives republish), served with Range support; views mint earnings (monetization_settings 'clip', dedupe per viewer IP in one transaction) and clips earnings feed the PPO revenue pool. Upload rate-limited (6/hour/IP, 2GB max). Files: `artifacts/api-server/src/routes/clips.ts`, `artifacts/gdna-arena/src/pages/clips.tsx`. Why: owner ordered a Reels-shaped clips tab with the 2-min producer rule and IP-rights guarantee.
- **GDNA Update - Aug 16, 2026**: (1) PPO unified income distribution integrated with the rights system — new `artifacts/api-server/src/routes/ppo.ts` (beneficiaries with 100%-sum rule, chat-tab revenue on `dm_rooms.revenue`, transactional distributions in exact cents with advisory lock; all mutations serialized under the same lock; soft-delete keeps the payout ledger) + one admin page `/admin/revenue` with 3 sections (القديم/التابات/التوزيع) in `artifacts/gdna-arena/src/pages/admin-revenue.tsx`. (2) Calls confirmed fully on Agora (App ID in `useCall.ts`/`routes/rtc.ts`, no Metered/TURN anywhere); added `remote-player`/`local-player` ids in `CallOverlay.tsx` per owner's order. Why: owner ordered PPO integration and the Agora queue task.
- **GDNA Update - Aug 15, 2026 (2)**: AMIS rebuilt WhatsApp-style — 4 fixed bottom tabs (Discussions | Actus | Communautés | Appels), fullscreen chat page (portaled to body — header: avatar+name+call buttons; date separators; two-row composer: big dir=auto 16px textarea + 5 fixed buttons camera/image/file/voice/emoji), GIPHY removed completely, keyboard-stable via dvh + `interactive-widget=resizes-content` viewport meta. Also: room-scoped message fetching (no stale cross-room leaks), mic recorder cleanup on unmount, WhatsApp float hidden while chat is open. Where: `artifacts/gdna-arena/src/components/messenger/Messenger.tsx`, `artifacts/gdna-arena/index.html`. Why: owner reported hidden Arabic text, tiny input, unstable keyboard, and chaotic chat UI.
- **GDNA Update - Aug 15, 2026**: AMIS unified (task #131) — one shared `Messenger` component (full/embedded/widget) now powers /messages, the Social tab, and the floating widget. Added: settings (notifications/read receipts with real privacy semantics), per-room mute, delete own message, groups discovery + join, contacts tab, honest "encrypted via server" label, accurate call history (answered only when a call actually connects). Where: `artifacts/gdna-arena/src/components/messenger/Messenger.tsx`, `CommHub.tsx`, `hooks/useCall.ts`, `artifacts/api-server/src/routes/messages.ts`. Why: 3 divergent messenger UIs were confusing; one component = one place to restyle and fix.

## Gotchas

- Every Drizzle schema change must include a generated migration. Run `pnpm --filter @workspace/db run generate --name=<change-name>` after editing the schema, then `pnpm --filter @workspace/db run migrate`. The post-merge script applies committed migrations automatically in development.
- Do NOT run `pnpm dev` at workspace root — use workflow names via WorkflowsRestart tool
- The 401 in browser console on home page is expected — `/api/me` returns 401 when not logged in; AuthContext handles it silently
