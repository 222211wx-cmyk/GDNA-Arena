---
name: GlobalStar Tournament
description: GlobalStar is integrated as a 4th game inside gdna-arena — not a separate artifact. Tournament simulation with 100 players.
---

## Structure

GlobalStar lives INSIDE gdna-arena (not a separate artifact):
- Game card: `/games` — 4th card with gold "♔ TOURNAMENT" badge
- Tournament API: `POST /api/games/globalstar/tournament`
- Voting hall: `/games/globalstar/ranking` (still accessible via "VIEW HALL OF LEGENDS →" link)
- Game router in `globalstar-app.tsx` uses `base="/games/globalstar"`

## Tournament System ("غربل غربل")

**Phases** (frontend in `games.tsx` TournamentModal component):
1. `entering` — counter 0→100 with player name grid
2. `simulating` — live score board with racing numbers (3s), API call fires here
3. `filtering` — "غربل غربل" elimination animation, names disappear
4. `revealing` — "CALCULATING YOUR DESTINY..." spinner
5. `done` — result with tier badge, coins, XP, play-again CTA

**Placement weights** (backend):
- 1% → 1st place
- 3% → 2nd-3rd
- 8% → 4th-10th
- 88% → 11th-100th

**Coin rewards:**
- 1st: 200 GDNA coins + 240 XP (champion)
- 2nd-3rd: 100 coins + 120 XP (elite)
- 4th-10th: 50 coins + 60 XP (legend)
- 11th-100th: 10 coins + 12 XP (citizen)

**DB side effects:** updates balance, xp, gamesPlayed, wins (if top 10), inserts transaction record. Results visible in dashboard + leaderboard.

**Why:**
User wanted GlobalStar as a proper game in the Arena with a cinematic "elimination tournament" mechanic — 100 players enter, top 10 survive, coins awarded by rank. The غربل غربل (filter/sieve) concept is the elimination phase.

**How to apply:**
- Never make GlobalStar `isExternal: true` — it should open the TournamentModal
- The voting app (ranking, figures, news) stays accessible at `/games/globalstar/*`
- The standard 3 games (neon-racer, crypto-clash, arena-strike) use `POST /api/games/:gameId/play` unchanged
