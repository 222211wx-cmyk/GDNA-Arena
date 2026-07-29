---
name: Empire Pulse
description: Social empire feed at /pulse — posts, international events, stats. Built July 2026.
---

# Empire Pulse

## What it is
Social command center at `/pulse` covering: تواصل · أحداث · رؤيا · تقدم · نمو · ازدهار · مناسبات

## Tables (CREATE TABLE IF NOT EXISTS in api-server/src/index.ts)
- `pulse_posts` — social feed posts (userId, username, content, domain, type, likes, is_visible)
- `pulse_events` — 15 seeded international events with isLive flag
- `pulse_post_likes` — dedup likes by IP

## API routes (artifacts/api-server/src/routes/pulse.ts)
- GET /api/pulse/feed?domain=all|sport|tech|music|business|cinema
- POST /api/pulse/post → +20 XP for logged-in users
- POST /api/pulse/post/:id/like → IP-deduped
- GET /api/pulse/events
- GET /api/pulse/stats (users, posts, coinsCirculating, totalXp, liveEvents)

## Live events seeded
FIFA World Cup 2026 (isLive=true), UEFA Champions League Final (isLive=true), + 13 upcoming events

## Navbar
"PULSE" entry added to Play dropdown group with Radio icon, color text-red-400

## Rewards
+20 XP per post (logged-in users only); likes are IP-deduplicated (no reward)

**Why:** User asked "واش گاينة شي امراطورية بلا تواصل احدات رويا احداث تقدم نمو ازدهار تواصل مناسبات" — empire needs communication, events, vision, progress.
