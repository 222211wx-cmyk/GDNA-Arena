# GDNA Arena

Play-to-earn crypto gaming platform — players register, compete in 3 arenas, earn coins & XP, claim daily rewards, chat with an AI genie, and track stats on a leaderboard.

## Run & Operate

- `pnpm --filter @workspace/gdna-arena run dev` — frontend (port from env)
- `pnpm --filter @workspace/api-server run dev` — API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
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
- **GDNA Update - Aug 16, 2026**: (1) PPO unified income distribution integrated with the rights system — new `artifacts/api-server/src/routes/ppo.ts` (beneficiaries with 100%-sum rule, chat-tab revenue on `dm_rooms.revenue`, transactional distributions in exact cents with advisory lock; all mutations serialized under the same lock; soft-delete keeps the payout ledger) + one admin page `/admin/revenue` with 3 sections (القديم/التابات/التوزيع) in `artifacts/gdna-arena/src/pages/admin-revenue.tsx`. (2) Calls confirmed fully on Agora (App ID in `useCall.ts`/`routes/rtc.ts`, no Metered/TURN anywhere); added `remote-player`/`local-player` ids in `CallOverlay.tsx` per owner's order. Why: owner ordered PPO integration and the Agora queue task.
- **GDNA Update - Aug 15, 2026 (2)**: AMIS rebuilt WhatsApp-style — 4 fixed bottom tabs (Discussions | Actus | Communautés | Appels), fullscreen chat page (portaled to body — header: avatar+name+call buttons; date separators; two-row composer: big dir=auto 16px textarea + 5 fixed buttons camera/image/file/voice/emoji), GIPHY removed completely, keyboard-stable via dvh + `interactive-widget=resizes-content` viewport meta. Also: room-scoped message fetching (no stale cross-room leaks), mic recorder cleanup on unmount, WhatsApp float hidden while chat is open. Where: `artifacts/gdna-arena/src/components/messenger/Messenger.tsx`, `artifacts/gdna-arena/index.html`. Why: owner reported hidden Arabic text, tiny input, unstable keyboard, and chaotic chat UI.
- **GDNA Update - Aug 15, 2026**: AMIS unified (task #131) — one shared `Messenger` component (full/embedded/widget) now powers /messages, the Social tab, and the floating widget. Added: settings (notifications/read receipts with real privacy semantics), per-room mute, delete own message, groups discovery + join, contacts tab, honest "encrypted via server" label, accurate call history (answered only when a call actually connects). Where: `artifacts/gdna-arena/src/components/messenger/Messenger.tsx`, `CommHub.tsx`, `hooks/useCall.ts`, `artifacts/api-server/src/routes/messages.ts`. Why: 3 divergent messenger UIs were confusing; one component = one place to restyle and fix.

## Gotchas

- `pnpm --filter @workspace/db run push` must be run after schema changes in dev
- Do NOT run `pnpm dev` at workspace root — use workflow names via WorkflowsRestart tool
- The 401 in browser console on home page is expected — `/api/me` returns 401 when not logged in; AuthContext handles it silently
