---
name: Stars Hall + AI Council
description: World-star AI citizens in AMIS; AMEEQ imperial council reports
---
**Stars Hall (⭐ قاعة النجوم):** 12 world stars seeded as AI honorary citizens (routes/stars.ts). A star account = roster username AND reserved email `<username>@stars.gdna.empire` — never match by username alone. AI replies are gated on a `star_invites` entitlement (3 invites/day, advisory-lock protected); a room created directly with a star gets NO AI reply (cost-bypass guard). Star rooms allow trivial/casual messages (moderation `allowTrivial`).

**Imperial AI Council:** AMEEQ (public /api/ameeq chat) is the sovereign external governor persona; daily council report job (jobs/council-report.ts) files an Arabic governance report into `council_reports`, idempotent per day via unique `report_date` index + pre-OpenAI existence check (why: prevents duplicate OpenAI spend across restarts/instances). Latest reports served at GET /api/governor/council-reports (auth), shown as a collapsible panel on /ameeq.
