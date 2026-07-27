---
name: GlobalStar Platform
description: Key decisions and gotchas for the GlobalStar voting platform at /globalstar/
---

## Routes in App.tsx must be relative (no /globalstar/ prefix)
WouterRouter already sets `base={import.meta.env.BASE_URL.replace(/\/$/, '')}` which resolves to `/globalstar`. Routes inside Switch must be `/`, `/ranking`, etc. — NOT `/globalstar/ranking`.

**Why:** BASE_URL is already the prefix. Hardcoding it in routes causes 404 on every page.

## Language context: avoid duplicate keys
Translation objects had `traditions` appearing twice (once as nav label, once as page label). Second occurrence renamed to `traditionsLabel`. Same pattern applies if adding any nav key that matches a content key.

## useRef with NodeJS.Timeout
`useRef<NodeJS.Timeout>()` (no initial value) fails TypeScript. Use `useRef<ReturnType<typeof setInterval> | null>(null)` instead.

## AI moderation is live
`artifacts/api-server/src/routes/globalstar.ts` calls `openai.moderations.create()` on any vote comment. Fails open (returns ok:true) if OpenAI is down so votes still work.

## DB tables
gs_figures, gs_votes, gs_news, gs_traditions — all seeded with 37 figures across 10 domains, 20 news articles, 15 traditions/archaeological sites.

## 10 domains (static, defined in route file)
sport, music, cinema, politics, science, culture, business, social, history, archaeology
