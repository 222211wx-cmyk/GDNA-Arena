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

_Populate as you build._

## Gotchas

- `pnpm --filter @workspace/db run push` must be run after schema changes in dev
- Do NOT run `pnpm dev` at workspace root — use workflow names via WorkflowsRestart tool
- The 401 in browser console on home page is expected — `/api/me` returns 401 when not logged in; AuthContext handles it silently
