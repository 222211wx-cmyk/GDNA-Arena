---
name: Empire Levels & Revenue Split
description: 4-level XP system with earnings multipliers, and division-based revenue split (GLOBALSTAR/TV/MUSIC/MERCH)
---

## Levels
- Level derived from `users.xp`, never stored (source of truth: `api-server/src/lib/levels.ts`). L1 مبتدئ 0–100, L2 محترف 101–500, L3 خبير 501–2000, L4 أسطورة 2001+.
- Perks: earnings multiplier (×1 / ×1.25 / ×1.5 / ×2) applied to the CONTENT AUTHOR's level on pulse likes and gs views; GIF search result limit scales with level; L3+ unlock GIPHY stickers (exclusive).
- **Why:** rewarding creators, not likers — multiplier must always come from the author/uploader, never the viewer.
- gs view earnings are INCREMENTAL (`earnings + rate×mult`), not recomputed from views — past earnings at old rates/levels stay honest; frozen uploads keep earnings unchanged.
- Dashboard `getRank` mirrors the same 4 levels; progress = (xp−min)/(next−min), keep client and server tables in sync.

## Revenue split
- `revenue_divisions` table: GLOBALSTAR 40 / GDNA TV 30 / GDNA MUSIC 20 / GDNA MERCH 10. Admin PATCH `/rights/admin/divisions` requires exactly one entry per known division AND sum = 100 (duplicate divisions rejected). Finance dashboard at `/rights/admin/finance`, shown in the admin-withdrawals page ("الإدارة المالية" section).

## Moderation gotchas (durable)
- JS `\W` treats Arabic letters as non-word chars — trivial-content pattern `/^\W+$/` silently blocked ALL pure-Arabic posts. Use Unicode-aware `/^[^\p{L}\p{N}]+$/u` for "symbols only" checks.
- Username moderation must pass `allowTrivial: true` — the 15-char "substance" minimum otherwise rejects almost every username (3–20 char field).
