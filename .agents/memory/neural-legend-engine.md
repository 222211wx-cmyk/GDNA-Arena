---
name: Neural Legend Engine
description: TOP 10 global legends system at /legends and /legends/:id (4-tab hub). Built July 2026.
---

# Neural Legend Engine v1.0

## Pages
- `/legends` — animated leaderboard, ranked by Neural Score, auto-refresh every 30s
- `/legends/:id` — 4-tab hub per legend

## 4 Tabs
1. NOSTALGIA DNA — timeline (childhood/training/breakthrough/stardom) with image
2. PEAK MOMENTS — YouTube embeds, +10 coins per watch (IP-deduped)
3. DEBATE ARENA — live chat polling every 5s, +50 XP per message
4. LEGEND CARD — dynamic stats card (clutch/legacy/style/impact/peak)

## DB tables (CREATE TABLE IF NOT EXISTS)
- `legends` — id, name, domain, nationality, rank, score, image_url, peak_year, bio (jsonb), videos (jsonb), stats (jsonb)
- `legend_debates` — id, legend_id, user_id, username, message, likes
- `legend_watches` — id, legend_id, user_id, voter_ip, video_id

## API routes (artifacts/api-server/src/routes/legends.ts)
- GET /api/legends
- GET /api/legends/:id
- POST /api/legends/:id/debate → +50 XP
- POST /api/legends/:id/watch → +10 coins (IP-deduped per video)
- POST /api/legends/:id/debate/:debateId/like

## 10 Seeded Legends
CR7 (#1, Sport), Messi (#2, Sport), Elon Musk (#3, Tech), Beyoncé (#4, Music), LeBron (#5, Sport), Taylor Swift (#6, Music), Federer (#7, Sport), Steve Jobs (#8, Tech), Serena Williams (#9, Sport), Muhammad Ali (#10, Sport)

**Why:** User requested "NEURAL LEGEND ENGINE v1.0 — TOP 10 global icons with AI-generated hub pages"
